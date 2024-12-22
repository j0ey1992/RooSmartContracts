const { expect } = require("chai");
const { ethers } = require("hardhat");
const admin = require("firebase-admin");
require('dotenv').config();

describe("Casino System Integration", function () {
    let tokenPool;
    let token;
    let owner;
    let operator;
    let user;
    let user2; // Another user for testing pool creation
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

            db = admin.firestore();
            db.settings({ databaseId: 'roodatabase' });

            // Initialize test collections
            await db.collection('test').doc('init').set({
                initialized: true,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            await db.collection('balances').doc('init').set({
                initialized: true,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log('Firebase collections initialized successfully');
        } catch (error) {
            console.error("Firebase initialization error:", error);
            throw error;
        }
    });

    beforeEach(async function () {
        const signers = await ethers.getSigners();
        owner = signers[0];
        operator = signers[1];
        user = signers[2];
        user2 = signers[3];
        platformWallet = signers[4];

        // Deploy factory first
        const CasinoFactory = await ethers.getContractFactory("CasinoFactory");
        factory = await CasinoFactory.deploy();
        await factory.initialize(await platformWallet.getAddress());

        // Set operator
        await factory.setOperator(await operator.getAddress(), true, "test-operator");

        // Deploy router and set it in factory
        const CasinoRouter = await ethers.getContractFactory("CasinoRouter");
        router = await CasinoRouter.deploy(await factory.getAddress());
        await factory.setRouter(await router.getAddress());

        // Deploy test tokens
        const TestToken = await ethers.getContractFactory("TestToken");
        token = await TestToken.deploy();
        const token2 = await TestToken.deploy(); // Second token for testing user-created pools

        // Set pool creation fee
        await factory.setPoolCreationFee(ethers.parseEther("0.1")); // 0.1 ETH fee

        // Clear any existing balance documents
        if (user) {
            try {
                await db.collection('balances').doc(await user.getAddress()).delete();
            } catch (error) {}
        }
        if (user2) {
            try {
                await db.collection('balances').doc(await user2.getAddress()).delete();
            } catch (error) {}
        }
    });

    describe("Pool Creation and Management", function () {
        it("Should allow users to create pools with fee", async function () {
            // User creates pool
            await expect(
                factory.connect(user2).createPool(await token.getAddress(), {
                    value: ethers.parseEther("0.1")
                })
            ).to.emit(factory, "PoolCreated");

            // Verify pool exists
            const [exists, poolAddress] = await factory.getPool(await token.getAddress());
            expect(exists).to.be.true;

            // Verify factory ownership
            tokenPool = await ethers.getContractAt("TokenPool", poolAddress);
            expect(await tokenPool.owner()).to.equal(await factory.getAddress());
        });

        it("Should prevent pool creation without fee", async function () {
            await expect(
                factory.connect(user2).createPool(await token.getAddress())
            ).to.be.revertedWithCustomError(factory, "InvalidAmount");
        });
    });

    describe("Deposit and Game Flow", function () {
        beforeEach(async function () {
            // Create pool with fee
            await factory.connect(user2).createPool(await token.getAddress(), {
                value: ethers.parseEther("0.1")
            });
            const [exists, poolAddress] = await factory.getPool(await token.getAddress());
            tokenPool = await ethers.getContractAt("TokenPool", poolAddress);

            // Mint tokens to user and approve router
            await token.mint(await user.getAddress(), ethers.parseEther("1000"));
            await token.connect(user).approve(await router.getAddress(), ethers.parseEther("1000"));
        });

        it("Should handle deposits and update Firebase balance", async function () {
            const depositAmount = ethers.parseEther("100");
            
            // No fee on deposits
            await router.connect(user).depositToPool(await token.getAddress(), depositAmount);

            // Verify Firebase balance was updated with full amount
            const firebaseBalance = await tokenPool.firebaseBalances(await user.getAddress());
            expect(firebaseBalance).to.equal(depositAmount);
        });

        it("Should process game results and update Firebase balance", async function () {
            const depositAmount = ethers.parseEther("100");
            const betAmount = ethers.parseEther("10");
            const winAmount = ethers.parseEther("20");

            // Initial deposit (no fee)
            await router.connect(user).depositToPool(await token.getAddress(), depositAmount);

            // Process game result
            await tokenPool.connect(operator).processGameResult(
                await user.getAddress(),
                betAmount,
                winAmount
            );

            // Calculate expected balance after game
            // 2% LP fee + 1% platform fee = 3% total fee on winnings
            const totalFee = winAmount * 300n / 10000n;
            const netWin = winAmount - totalFee;
            const expectedBalance = depositAmount - betAmount + netWin;

            // Verify Firebase balance reflects win
            const firebaseBalance = await tokenPool.firebaseBalances(await user.getAddress());
            expect(firebaseBalance).to.equal(expectedBalance);
        });

        it("Should prevent betting more than Firebase balance", async function () {
            const depositAmount = ethers.parseEther("100");
            const betAmount = ethers.parseEther("150"); // More than deposit

            // Initial deposit
            await router.connect(user).depositToPool(await token.getAddress(), depositAmount);

            // Try to bet more than balance
            await expect(
                tokenPool.connect(operator).processGameResult(
                    await user.getAddress(),
                    betAmount,
                    0
                )
            ).to.be.revertedWithCustomError(tokenPool, "InsufficientBalance");
        });
    });

    describe("Withdrawal and Liquidity", function () {
        beforeEach(async function () {
            // Create pool with fee
            await factory.connect(user2).createPool(await token.getAddress(), {
                value: ethers.parseEther("0.1")
            });
            const [exists, poolAddress] = await factory.getPool(await token.getAddress());
            tokenPool = await ethers.getContractAt("TokenPool", poolAddress);

            // Mint tokens to users and approve
            await token.mint(await user.getAddress(), ethers.parseEther("1000"));
            await token.connect(user).approve(await router.getAddress(), ethers.parseEther("1000"));
            await token.mint(await user2.getAddress(), ethers.parseEther("1000"));
            await token.connect(user2).approve(await tokenPool.getAddress(), ethers.parseEther("1000"));
        });

        it("Should allow withdrawal up to Firebase balance", async function () {
            const depositAmount = ethers.parseEther("100");
            
            // User deposits (no fee)
            await router.connect(user).depositToPool(await token.getAddress(), depositAmount);

            // Try to withdraw full amount
            await tokenPool.connect(user).withdraw(depositAmount);

            // Verify Firebase balance was reduced
            const firebaseBalance = await tokenPool.firebaseBalances(await user.getAddress());
            expect(firebaseBalance).to.equal(0);
        });

        it("Should handle liquidity provision and rewards correctly", async function () {
            // First LP adds 500 USDC
            const firstLPAmount = ethers.parseEther("500");
            await tokenPool.connect(user2).addLiquidity(firstLPAmount);

            // Second LP adds 500 USDC
            const user3 = (await ethers.getSigners())[4];
            await token.mint(await user3.getAddress(), ethers.parseEther("1000"));
            await token.connect(user3).approve(await tokenPool.getAddress(), ethers.parseEther("1000"));
            await tokenPool.connect(user3).addLiquidity(firstLPAmount);

            // Verify both LPs have 50% share
            const user2Shares = await tokenPool.shares(await user2.getAddress());
            const user3Shares = await tokenPool.shares(await user3.getAddress());
            expect(user2Shares).to.equal(user3Shares);

            // Player deposits enough for 10 bets of 100 USDC each
            const betAmount = ethers.parseEther("100");
            // Calculate total needed including platform fee
            // For 1000 USDC total bets, we need to deposit more to account for platform fee
            // Platform fee is 2.5% for liquidity operations
            const totalNeeded = (betAmount * 10n * 10000n) / (10000n - 250n);

            // Mint and approve enough tokens for the adjusted deposit amount
            await token.mint(await user.getAddress(), totalNeeded);
            await token.connect(user).approve(await router.getAddress(), totalNeeded);
            
            // Deposit
            await router.connect(user).depositToPool(await token.getAddress(), totalNeeded);

            // Get initial Firebase balance (should be enough for 10 bets)
            let expectedBalance = await tokenPool.firebaseBalances(await user.getAddress());
            expect(expectedBalance).to.be.gte(betAmount * 10n);

            // Process 10 losing bets
            for(let i = 0; i < 10; i++) {
                // Each bet is 100 USDC
                await tokenPool.connect(operator).processGameResult(
                    await user.getAddress(),
                    betAmount,
                    0 // Loss
                );

                // Calculate expected balance after bet
                expectedBalance -= betAmount;

                // Verify Firebase balance matches expected
                const currentBalance = await tokenPool.firebaseBalances(await user.getAddress());
                expect(currentBalance).to.equal(expectedBalance);
            }

            // Check rewards for both LPs
            const user2Rewards = await tokenPool.getPendingRewards(await user2.getAddress());
            const user3Rewards = await tokenPool.getPendingRewards(await user3.getAddress());
            
            // Each LP should get equal rewards
            // 10 bets of 100 USDC each = 1000 USDC total bets
            // 2% LP fee on each bet = 20 USDC total LP fees
            // Split between 2 LPs = 10 USDC each
            const expectedRewardPerLP = ethers.parseEther("10");
            expect(user2Rewards).to.be.closeTo(expectedRewardPerLP, ethers.parseEther("0.5")); // Allow 0.5 USDC margin
            expect(user2Rewards).to.equal(user3Rewards);

            // Get pool state before new LP
            const totalDeposits = await tokenPool.totalDeposits();
            const totalSharesBefore = await tokenPool.totalShares();
            console.log('Total deposits before:', ethers.formatEther(totalDeposits));
            console.log('Total shares before:', ethers.formatEther(totalSharesBefore));

            // New LP joins with 200 USDC when pool value is higher
            const user4 = (await ethers.getSigners())[5];
            await token.mint(await user4.getAddress(), ethers.parseEther("1000"));
            await token.connect(user4).approve(await tokenPool.getAddress(), ethers.parseEther("1000"));
            
            const lpAmount = ethers.parseEther("200");
            await tokenPool.connect(user4).addLiquidity(lpAmount);

            // Get final shares
            const user4Shares = await tokenPool.shares(await user4.getAddress());
            const totalShares = await tokenPool.totalShares();
            const user4SharePercent = (user4Shares * 100n) / totalShares;

            // Log actual values
            console.log('User4 shares:', ethers.formatEther(user4Shares));
            console.log('Total shares after:', ethers.formatEther(totalShares));
            console.log('User4 share percent:', Number(user4SharePercent));
            console.log('Expected ~9% (200/1970)');

            // Verify share percentage
            // Initial pool: 1000 (500 + 500)
            // After 10 bets: 2926.25 (including fees)
            // New LP adds 200
            // Expected share: (200/2926.25) ≈ 6.8%
            expect(user4SharePercent).to.be.closeTo(7n, 1n); // Allow 1% margin

            // Claim rewards
            await tokenPool.connect(user2).claimRewards();
            await tokenPool.connect(user3).claimRewards();
        });
    });

    after(async function () {
        // Cleanup Firebase test data
        try {
            if (user) await db.collection('balances').doc(await user.getAddress()).delete();
            if (user2) await db.collection('balances').doc(await user2.getAddress()).delete();
            await db.collection('test').doc('init').delete();
            await db.collection('balances').doc('init').delete();
        } catch (error) {
            console.error("Error cleaning up Firebase data:", error);
        }
    });
});
