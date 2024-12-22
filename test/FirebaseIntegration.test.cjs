const { expect } = require("chai");
const { ethers } = require("hardhat");
const admin = require("firebase-admin");
require('dotenv').config();

describe("Casino Firebase Integration", function () {
    let tokenPool;
    let token;
    let owner;
    let operator;
    let user;
    let platformWallet;
    let factory;
    let router;
    let db;

    // Helper function to get next nonce for a user
    async function getNextNonce(user) {
        const currentNonce = await tokenPool.balanceNonces(user);
        return currentNonce + BigInt(1);
    }

    // Firebase setup
    before(async function () {
        try {
            // Initialize Firebase Admin with service account
            if (!admin.apps.length) {
                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: process.env.FIREBASE_PROJECT_ID,
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
                    }),
                    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`,
                    projectId: process.env.FIREBASE_PROJECT_ID
                });
            }

            // Initialize Firestore with specific database
            db = admin.firestore();
            db.settings({
                databaseId: 'roodatabase'
            });

            // Try to create test collections
            try {
                // Create a test collection and document to ensure database exists
                const testRef = db.collection('test').doc('init');
                await testRef.set({
                    initialized: true,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                // Create balances collection
                const balancesRef = db.collection('balances').doc('init');
                await balancesRef.set({
                    initialized: true,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                console.log('Firebase collections initialized successfully');
            } catch (error) {
                console.error('Error initializing Firebase collections:', error);
                throw error;
            }

        } catch (error) {
            console.error("Firebase initialization error:", error);
            throw error;
        }
    });

    beforeEach(async function () {
        // Get signers
        const signers = await ethers.getSigners();
        owner = signers[0];
        operator = signers[1];
        user = signers[2];
        platformWallet = signers[3];

        // Deploy test token
        const TestToken = await ethers.getContractFactory("TestToken");
        token = await TestToken.deploy();
        const tokenAddress = await token.getAddress();

        // Deploy factory
        const CasinoFactory = await ethers.getContractFactory("CasinoFactory");
        factory = await CasinoFactory.deploy();
        await factory.initialize(await platformWallet.getAddress());

        // Set operator
        await factory.setOperator(await operator.getAddress(), true, "test-operator");

        // Deploy pool
        await factory.createPool(tokenAddress);
        const [exists, poolAddress] = await factory.getPool(tokenAddress);
        tokenPool = await ethers.getContractAt("TokenPool", poolAddress);

        // Deploy router
        const CasinoRouter = await ethers.getContractFactory("CasinoRouter");
        router = await CasinoRouter.deploy(await factory.getAddress());

        // Mint tokens to user
        await token.mint(await user.getAddress(), ethers.parseEther("1000"));
        await token.connect(user).approve(await router.getAddress(), ethers.parseEther("1000"));

        // Clear any existing balance documents for this user
        if (user) {
            const userBalanceRef = db.collection('balances').doc(await user.getAddress());
            try {
                await userBalanceRef.delete();
            } catch (error) {
                // Ignore if document doesn't exist
            }
        }
    });

    describe("Deposit and Firebase Balance", function () {
        it("Should deposit and update Firebase balance", async function () {
            const depositAmount = ethers.parseEther("100");
            
            // User deposits
            await router.connect(user).depositToPool(await token.getAddress(), depositAmount);

            // Update Firebase balance
            const userBalanceRef = db.collection('balances').doc(await user.getAddress());
            await userBalanceRef.set({
                balance: depositAmount.toString(),
                lastUpdate: admin.firestore.FieldValue.serverTimestamp()
            });

            // Verify Firebase balance
            const balanceDoc = await userBalanceRef.get();
            expect(balanceDoc.exists).to.be.true;
            expect(balanceDoc.data().balance).to.equal(depositAmount.toString());
        });

        it("Should prevent withdrawal exceeding Firebase balance", async function () {
            const depositAmount = ethers.parseEther("100");
            const withdrawAmount = ethers.parseEther("150"); // More than deposit

            // User deposits
            await router.connect(user).depositToPool(await token.getAddress(), depositAmount);

            // Set Firebase balance
            const userBalanceRef = db.collection('balances').doc(await user.getAddress());
            await userBalanceRef.set({
                balance: depositAmount.toString(),
                lastUpdate: admin.firestore.FieldValue.serverTimestamp()
            });

            // Update contract's Firebase balance
            const nonce = await getNextNonce(await user.getAddress());
            await tokenPool.connect(operator).updateFirebaseBalance(
                await user.getAddress(),
                depositAmount,
                nonce
            );

            // Try to withdraw more than Firebase balance
            await expect(
                tokenPool.connect(user).withdraw(withdrawAmount)
            ).to.be.revertedWithCustomError(tokenPool, "ExceedsFirebaseBalance");
        });

        it("Should process game results and update Firebase balance", async function () {
            const depositAmount = ethers.parseEther("100");
            const betAmount = ethers.parseEther("10");
            const winAmount = ethers.parseEther("20");

            // Initial deposit
            await router.connect(user).depositToPool(await token.getAddress(), depositAmount);

            // Update Firebase with game result
            const userBalanceRef = db.collection('balances').doc(await user.getAddress());
            await userBalanceRef.set({
                balance: (BigInt(depositAmount) + BigInt(winAmount)).toString(),
                lastUpdate: admin.firestore.FieldValue.serverTimestamp()
            });

            // Process game result through operator
            await tokenPool.connect(operator).processGameResult(
                await user.getAddress(),
                betAmount,
                winAmount
            );

            // Verify Firebase balance matches
            const balanceDoc = await userBalanceRef.get();
            expect(balanceDoc.data().balance).to.equal(
                (BigInt(depositAmount) + BigInt(winAmount)).toString()
            );
        });

        it("Should handle multiple game sessions", async function () {
            const depositAmount = ethers.parseEther("100");
            
            // Initial deposit
            await router.connect(user).depositToPool(await token.getAddress(), depositAmount);
            
            // Simulate multiple game sessions
            const sessions = [
                { bet: "10", win: "15" },
                { bet: "20", loss: true },
                { bet: "30", win: "45" }
            ];

            let currentBalance = BigInt(depositAmount);
            const userBalanceRef = db.collection('balances').doc(await user.getAddress());

            for (const session of sessions) {
                const betAmount = ethers.parseEther(session.bet);
                
                if (session.loss) {
                    currentBalance = currentBalance - BigInt(betAmount);
                } else {
                    const winAmount = ethers.parseEther(session.win);
                    currentBalance = currentBalance - BigInt(betAmount) + BigInt(winAmount);
                }

                // Update Firebase
                await userBalanceRef.set({
                    balance: currentBalance.toString(),
                    lastUpdate: admin.firestore.FieldValue.serverTimestamp()
                });

                // Process game result
                await tokenPool.connect(operator).processGameResult(
                    await user.getAddress(),
                    betAmount,
                    session.loss ? 0 : ethers.parseEther(session.win)
                );

                // Verify balance
                const balanceDoc = await userBalanceRef.get();
                expect(balanceDoc.data().balance).to.equal(currentBalance.toString());
            }
        });
    });

    after(async function () {
        // Cleanup Firebase test data
        if (user) {
            const userBalanceRef = db.collection('balances').doc(await user.getAddress());
            try {
                await userBalanceRef.delete();
            } catch (error) {
                console.error("Error cleaning up Firebase data:", error);
            }
        }

        // Clean up initialization documents
        try {
            await db.collection('test').doc('init').delete();
            await db.collection('balances').doc('init').delete();
        } catch (error) {
            // Ignore if documents don't exist
        }
    });
});
