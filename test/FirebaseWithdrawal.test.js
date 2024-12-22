const { expect } = require("chai");
const { ethers } = require("hardhat");
const admin = require('firebase-admin');

describe("Firebase Withdrawal Integration", function () {
    let testToken, factory, router, pool;
    let owner, platformWallet, player, operator;

    before(async function () {
        // Initialize Firebase Admin
        if (!admin.apps.length) {
            admin.initializeApp({
                projectId: "trollslots",
                credential: admin.credential.cert({
                    projectId: "trollslots",
                    clientEmail: "firebase-adminsdk-zbglg@trollslots.iam.gserviceaccount.com",
                    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
                })
            });
        }
    });

    beforeEach(async function () {
        [owner, platformWallet, player, operator] = await ethers.getSigners();

        // Deploy TestToken
        const TestToken = await ethers.getContractFactory("TestToken");
        testToken = await TestToken.deploy();
        await testToken.deployed();

        // Deploy Factory
        const CasinoFactory = await ethers.getContractFactory("CasinoFactory");
        factory = await CasinoFactory.deploy();
        await factory.deployed();

        // Initialize factory
        await factory.initialize(platformWallet.address);
        await factory.setOperator(operator.address, true, "test-operator");

        // Create pool
        await factory.createPool(testToken.address);
        const [exists, poolAddress] = await factory.getPool(testToken.address);
        const TokenPool = await ethers.getContractFactory("TokenPool");
        pool = TokenPool.attach(poolAddress);

        // Deploy Router
        const CasinoRouter = await ethers.getContractFactory("CasinoRouter");
        router = await CasinoRouter.deploy(factory.address);
        await router.deployed();

        // Mint tokens to player
        await testToken.mint(player.address, ethers.utils.parseEther("1000"));
        await testToken.connect(player).approve(router.address, ethers.utils.parseEther("1000"));
    });

    describe("Firebase Balance Verification", function () {
        it("Should deposit and update Firebase balance", async function () {
            const depositAmount = ethers.utils.parseEther("100");
            
            // Deposit through router
            await router.connect(player).depositToPool(testToken.address, depositAmount);

            // Update Firebase balance
            const userBalanceRef = admin.firestore()
                .collection('balances')
                .doc(player.address);
            
            await userBalanceRef.set({
                balance: ethers.utils.formatEther(depositAmount),
                token: testToken.address,
                lastUpdate: admin.firestore.FieldValue.serverTimestamp()
            });

            // Verify Firebase balance
            const balanceDoc = await userBalanceRef.get();
            expect(balanceDoc.exists).to.be.true;
            expect(parseFloat(balanceDoc.data().balance)).to.equal(
                parseFloat(ethers.utils.formatEther(depositAmount))
            );
        });

        it("Should withdraw with operator signature", async function () {
            const depositAmount = ethers.utils.parseEther("100");
            const withdrawAmount = ethers.utils.parseEther("50");
            
            // Initial deposit
            await router.connect(player).depositToPool(testToken.address, depositAmount);

            // Update Firebase balance
            const userBalanceRef = admin.firestore()
                .collection('balances')
                .doc(player.address);
            
            await userBalanceRef.set({
                balance: ethers.utils.formatEther(depositAmount),
                token: testToken.address,
                lastUpdate: admin.firestore.FieldValue.serverTimestamp()
            });

            // Create withdrawal signature
            const blockNumber = await ethers.provider.getBlockNumber();
            const withdrawalHash = ethers.utils.solidityKeccak256(
                ['address', 'uint256', 'uint256'],
                [player.address, withdrawAmount, blockNumber]
            );
            const messageHashBytes = ethers.utils.arrayify(withdrawalHash);
            const signature = await operator.signMessage(messageHashBytes);

            // Update Firebase balance for withdrawal
            await pool.connect(operator).updateFirebaseBalance(
                player.address,
                withdrawAmount,
                signature
            );

            // Execute withdrawal
            await router.connect(player).withdrawFromPoolWithSignature(
                testToken.address,
                withdrawAmount,
                signature
            );

            // Verify Firebase balance updated
            const afterBalanceDoc = await userBalanceRef.get();
            expect(parseFloat(afterBalanceDoc.data().balance)).to.equal(
                parseFloat(ethers.utils.formatEther(depositAmount.sub(withdrawAmount)))
            );
        });

        it("Should prevent withdrawal with invalid signature", async function () {
            const depositAmount = ethers.utils.parseEther("100");
            const withdrawAmount = ethers.utils.parseEther("50");
            
            // Initial deposit
            await router.connect(player).depositToPool(testToken.address, depositAmount);

            // Update Firebase balance
            const userBalanceRef = admin.firestore()
                .collection('balances')
                .doc(player.address);
            
            await userBalanceRef.set({
                balance: ethers.utils.formatEther(depositAmount),
                token: testToken.address,
                lastUpdate: admin.firestore.FieldValue.serverTimestamp()
            });

            // Try to withdraw with invalid signature
            const invalidSignature = ethers.utils.hexlify(ethers.utils.randomBytes(65));
            
            await expect(
                router.connect(player).withdrawFromPoolWithSignature(
                    testToken.address,
                    withdrawAmount,
                    invalidSignature
                )
            ).to.be.revertedWith("Invalid withdrawal signature");
        });

        it("Should prevent withdrawal exceeding Firebase balance", async function () {
            const depositAmount = ethers.utils.parseEther("100");
            const withdrawAmount = ethers.utils.parseEther("150"); // More than deposit
            
            // Initial deposit
            await router.connect(player).depositToPool(testToken.address, depositAmount);

            // Update Firebase balance
            const userBalanceRef = admin.firestore()
                .collection('balances')
                .doc(player.address);
            
            await userBalanceRef.set({
                balance: ethers.utils.formatEther(depositAmount),
                token: testToken.address,
                lastUpdate: admin.firestore.FieldValue.serverTimestamp()
            });

            // Create withdrawal signature
            const blockNumber = await ethers.provider.getBlockNumber();
            const withdrawalHash = ethers.utils.solidityKeccak256(
                ['address', 'uint256', 'uint256'],
                [player.address, withdrawAmount, blockNumber]
            );
            const messageHashBytes = ethers.utils.arrayify(withdrawalHash);
            const signature = await operator.signMessage(messageHashBytes);

            // Try to withdraw more than Firebase balance
            await expect(
                router.connect(player).withdrawFromPoolWithSignature(
                    testToken.address,
                    withdrawAmount,
                    signature
                )
            ).to.be.revertedWith("Exceeds Firebase balance");
        });
    });

    after(async function () {
        // Cleanup Firebase test data
        if (player?.address) {
            const userBalanceRef = admin.firestore()
                .collection('balances')
                .doc(player.address);
            await userBalanceRef.delete();
        }
    });
});
