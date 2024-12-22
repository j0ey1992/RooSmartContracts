const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Casino System Integration", function () {
    let TestToken, CasinoFactory, CasinoRouter, RooCasino;
    let testToken, testToken2, factory, router, casino;
    let owner, platformWallet, player, player2, operator, operator2, liquidityProvider;

    beforeEach(async function () {
        [owner, platformWallet, player, player2, operator, operator2, liquidityProvider] = await ethers.getSigners();

        try {
            // Deploy TestTokens
            console.log("Deploying TestTokens...");
            TestToken = await ethers.getContractFactory("TestToken");
            testToken = await TestToken.deploy();
            await testToken.waitForDeployment();
            testToken2 = await TestToken.deploy();
            await testToken2.waitForDeployment();
            console.log("TestTokens deployed successfully");

            // Deploy CasinoFactory
            console.log("Deploying CasinoFactory...");
            CasinoFactory = await ethers.getContractFactory("CasinoFactory");
            factory = await CasinoFactory.deploy();
            await factory.waitForDeployment();
            console.log("CasinoFactory deployed successfully");

            // Initialize factory
            console.log("Initializing factory...");
            await factory.initialize(platformWallet.address);
            console.log("Factory initialized successfully");

            // Set operators
            console.log("Setting operators...");
            await factory.setOperator(operator.address, true, "test-operator");
            await factory.setOperator(operator2.address, true, "test-operator-2");
            console.log("Operators set successfully");

            // Deploy CasinoRouter
            console.log("Deploying CasinoRouter...");
            CasinoRouter = await ethers.getContractFactory("CasinoRouter");
            const factoryAddress = await factory.getAddress();
            router = await CasinoRouter.deploy(factoryAddress);
            await router.waitForDeployment();
            const routerAddress = await router.getAddress();
            console.log("CasinoRouter deployed successfully at", routerAddress);

            // Deploy RooCasino
            console.log("Deploying RooCasino...");
            RooCasino = await ethers.getContractFactory("RooCasino");
            casino = await RooCasino.deploy(platformWallet.address);
            await casino.waitForDeployment();
            const casinoAddress = await casino.getAddress();
            console.log("RooCasino deployed successfully at", casinoAddress);
        } catch (error) {
            console.error("Error during deployment:", error);
            throw error;
        }

        // Mint tokens
        try {
            // Get contract addresses
            const testTokenAddress = await testToken.getAddress();
            const testToken2Address = await testToken2.getAddress();

            // Mint tokens
            await testToken.mint(player.address, ethers.parseEther("1000"));
            await testToken.mint(player2.address, ethers.parseEther("1000"));
            await testToken.mint(liquidityProvider.address, ethers.parseEther("10000"));
            await testToken2.mint(player.address, ethers.parseEther("1000"));
            
            // Create pools
            await factory.createPool(testTokenAddress);
            await factory.createPool(testToken2Address);

            // Verify pools were created
            const [exists1, pool1] = await factory.getPool(testTokenAddress);
            const [exists2, pool2] = await factory.getPool(testToken2Address);
            
            if (!exists1 || !exists2 || pool1 === ethers.ZeroAddress || pool2 === ethers.ZeroAddress) {
                throw new Error("Failed to create pools");
            }
        } catch (error) {
            console.error("Error in token setup:", error);
            throw error;
        }
    });

    describe("Basic Integration Tests", function () {
        it("Should create pool and verify configuration", async function () {
            const testTokenAddress = await testToken.getAddress();
            const [exists, poolAddress] = await factory.getPool(testTokenAddress);
            expect(exists).to.be.true;
            expect(poolAddress).to.not.equal(ethers.ZeroAddress);

            const TokenPool = await ethers.getContractFactory("TokenPool");
            const pool = TokenPool.attach(poolAddress);
            
            expect(await pool.token()).to.equal(testTokenAddress);
            const factoryAddress = await factory.getAddress();
            expect(await pool.factory()).to.equal(factoryAddress);
            expect(await pool.platformWallet()).to.equal(platformWallet.address);
        });

        it("Should allow deposits through router", async function () {
            const depositAmount = ethers.parseEther("100");
            
            // Approve router to spend tokens
            const routerAddress = await router.getAddress();
            const testTokenAddress = await testToken.getAddress();
            await testToken.connect(player).approve(routerAddress, depositAmount);
            
            // Deposit through router
            await router.connect(player).depositToPool(testTokenAddress, depositAmount);
            
            // Get pool
            const [, poolAddress] = await factory.getPool(testTokenAddress);
            const TokenPool = await ethers.getContractFactory("TokenPool");
            const pool = TokenPool.attach(poolAddress);
            
            // Verify deposit (accounting for platform fee)
            const platformFee = depositAmount * 500n / 10000n; // 5% fee
            const expectedDeposit = depositAmount - platformFee;
            expect(await pool.getPoolBalance()).to.equal(expectedDeposit);
        });

        it("Should process game results correctly", async function () {
            const depositAmount = ethers.parseEther("1000");
            const betAmount = ethers.parseEther("100");
            
            // Approve and deposit
            const routerAddress = await router.getAddress();
            const testTokenAddress = await testToken.getAddress();
            await testToken.connect(player).approve(routerAddress, depositAmount);
            await router.connect(player).depositToPool(testTokenAddress, depositAmount);
            
            // Get pool
            const [, poolAddress] = await factory.getPool(testTokenAddress);
            const TokenPool = await ethers.getContractFactory("TokenPool");
            const pool = TokenPool.attach(poolAddress);
            
            // Process a winning game result
            const winAmount = ethers.parseEther("150"); // 50% profit
            await pool.connect(operator).processGameResult(
                player.address,
                betAmount,
                winAmount
            );
            
            // Calculate platform fee
            const platformFee = depositAmount * 500n / 10000n; // 5% fee

            // Verify pool balance changed correctly
            const gameFee = winAmount * 500n / 10000n; // 5% game fee
            const expectedBalance = depositAmount - platformFee - winAmount + gameFee;
            expect(await pool.getPoolBalance()).to.be.closeTo(expectedBalance, 1000n);
        });

        it("Should allow withdrawals", async function () {
            const depositAmount = ethers.parseEther("100");
            const withdrawAmount = ethers.parseEther("50");
            
            // Deposit first
            const routerAddress = await router.getAddress();
            const testTokenAddress = await testToken.getAddress();
            await testToken.connect(player).approve(routerAddress, depositAmount);
            await router.connect(player).depositToPool(testTokenAddress, depositAmount);
            
            // Withdraw through router
            await router.connect(player).withdrawFromPool(
                testTokenAddress,
                withdrawAmount
            );
            
            // Verify withdrawal
            const [, poolAddress] = await factory.getPool(testTokenAddress);
            const TokenPool = await ethers.getContractFactory("TokenPool");
            const pool = TokenPool.attach(poolAddress);
            
            const platformFee = depositAmount * 500n / 10000n; // 5% fee
            const expectedBalance = depositAmount - platformFee - withdrawAmount;
            expect(await pool.getPoolBalance()).to.equal(expectedBalance);
        });
    });

    describe("Factory Tests", function () {
        it("Should properly initialize factory settings", async function () {
            expect(await factory.platformWallet()).to.equal(platformWallet.address);
            expect(await factory.platformFee()).to.equal(500); // 5%
            expect(await factory.gameFee()).to.equal(500); // 5%
        });

        it("Should manage operators correctly", async function () {
            // Verify initial operators
            expect(await factory.isOperator(operator.address)).to.be.true;
            expect(await factory.isOperator(operator2.address)).to.be.true;
            expect(await factory.getOperatorName(operator.address)).to.equal("test-operator");

            // Remove operator
            await factory.setOperator(operator.address, false, "");
            expect(await factory.isOperator(operator.address)).to.be.false;

            // Add new operator
            await factory.setOperator(player.address, true, "new-operator");
            expect(await factory.isOperator(player.address)).to.be.true;
            expect(await factory.getOperatorName(player.address)).to.equal("new-operator");

            // Should revert when non-owner tries to set operator
            await expect(
                factory.connect(player).setOperator(player2.address, true, "invalid")
            ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
        });

        it("Should manage fees correctly", async function () {
            // Update platform fee
            await factory.setPlatformFee(600); // 6%
            expect(await factory.platformFee()).to.equal(600);

            // Update game fee
            await factory.setGameFee(700); // 7%
            expect(await factory.gameFee()).to.equal(700);

            // Should revert if fee is too high
            await expect(
                factory.setPlatformFee(1100)
            ).to.be.revertedWithCustomError(factory, "FeeTooHigh");

            // Should update fees in existing pools
            await factory.updateAllPoolFees();
            const testTokenAddress = await testToken.getAddress();
            const [, poolAddress] = await factory.getPool(testTokenAddress);
            const TokenPool = await ethers.getContractFactory("TokenPool");
            const pool = TokenPool.attach(poolAddress);
            expect(await pool.platformFee()).to.equal(600);
        });

        it("Should handle pool creation and management", async function () {
            // Get contract addresses
            const testTokenAddress = await testToken.getAddress();
            const testToken2Address = await testToken2.getAddress();

            // Verify existing pools
            let [exists, poolAddress] = await factory.getPool(testTokenAddress);
            expect(exists).to.be.true;
            expect(poolAddress).to.not.equal(ethers.ZeroAddress);

            // Should not allow duplicate pools
            await expect(
                factory.createPool(testTokenAddress)
            ).to.be.revertedWithCustomError(factory, "PoolAlreadyExists");

            // Get all deployed pools
            const [tokens, pools] = await factory.getDeployedPools();
            expect(tokens.length).to.equal(2); // testToken and testToken2
            expect(pools.length).to.equal(2);
            expect(tokens).to.include(testTokenAddress);
            expect(tokens).to.include(testToken2Address);
        });

        it("Should handle pause/unpause functionality", async function () {
            // Pause factory
            await factory.pause();
            expect(await factory.paused()).to.be.true;

            // Should not allow non-owner to pause/unpause
            await expect(
                factory.connect(player).pause()
            ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");

            // Unpause factory
            await factory.unpause();
            expect(await factory.paused()).to.be.false;
        });

        it("Should update platform wallet", async function () {
            await factory.updatePlatformWallet(player.address);
            expect(await factory.platformWallet()).to.equal(player.address);

            // Should not allow zero address
            await expect(
                factory.updatePlatformWallet(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(factory, "InvalidWalletAddress");
        });
    });

    describe("Pool Tests", function () {
        let pool;
        let poolAddress;

        beforeEach(async function () {
            const testTokenAddress = await testToken.getAddress();
            [, poolAddress] = await factory.getPool(testTokenAddress);
            const TokenPool = await ethers.getContractFactory("TokenPool");
            pool = TokenPool.attach(poolAddress);
        });

        describe("Liquidity Management", function () {
            it("Should handle liquidity provision correctly", async function () {
                const amount = ethers.parseEther("1000");
                await testToken.connect(liquidityProvider).approve(poolAddress, amount);
                
                // Add liquidity
                await pool.connect(liquidityProvider).addLiquidity(amount);
                expect(await pool.totalDeposits()).to.equal(amount);
                expect(await pool.totalShares()).to.equal(amount);
                expect(await pool.shares(liquidityProvider.address)).to.equal(amount);

                // Remove half liquidity
                const halfShares = amount / 2n;
                await pool.connect(liquidityProvider).removeLiquidity(halfShares);
                expect(await pool.totalShares()).to.equal(halfShares);
                expect(await pool.shares(liquidityProvider.address)).to.equal(halfShares);
            });

            it("Should distribute rewards correctly", async function () {
                // Add initial liquidity
                const lpAmount = ethers.parseEther("1000");
                await testToken.connect(liquidityProvider).approve(poolAddress, lpAmount);
                await pool.connect(liquidityProvider).addLiquidity(lpAmount);

                // Generate fees through game results
                const betAmount = ethers.parseEther("100");
                const winAmount = ethers.parseEther("150");
                await pool.connect(operator).processGameResult(
                    player.address,
                    betAmount,
                    winAmount
                );

                // Check rewards
                const pendingRewards = await pool.getPendingRewards(liquidityProvider.address);
                expect(pendingRewards).to.be.gt(0);

                // Claim rewards
                const beforeBalance = await testToken.balanceOf(liquidityProvider.address);
                await pool.connect(liquidityProvider).claimRewards();
                const afterBalance = await testToken.balanceOf(liquidityProvider.address);
                expect(afterBalance - beforeBalance).to.equal(pendingRewards);
            });
        });

        describe("Game Processing", function () {
            it("Should handle winning game results", async function () {
                // Add initial liquidity to handle payouts
                const liquidityAmount = ethers.parseEther("1000");
                await testToken.connect(liquidityProvider).approve(poolAddress, liquidityAmount);
                await pool.connect(liquidityProvider).addLiquidity(liquidityAmount);

                const betAmount = ethers.parseEther("100");
                const winAmount = ethers.parseEther("150");

                await pool.connect(operator).processGameResult(
                    player.address,
                    betAmount,
                    winAmount
                );

                const gameFee = winAmount * 500n / 10000n; // 5% game fee
                expect(await pool.accumulatedFees()).to.equal(gameFee);
            });

            it("Should handle losing game results", async function () {
                const betAmount = ethers.parseEther("100");
                const winAmount = ethers.parseEther("0");

                const beforeBalance = await pool.getPoolBalance();
                await pool.connect(operator).processGameResult(
                    player.address,
                    betAmount,
                    winAmount
                );

                expect(await pool.getPoolBalance()).to.equal(beforeBalance + betAmount);
            });

            it("Should only allow operators to process results", async function () {
                await expect(
                    pool.connect(player).processGameResult(
                        player.address,
                        ethers.parseEther("100"),
                        ethers.parseEther("150")
                    )
                ).to.be.revertedWithCustomError(pool, "NotAuthorized");
            });
        });

        describe("Security Features", function () {
            it("Should handle emergency withdrawal correctly", async function () {
                // Add some funds to pool
                const amount = ethers.parseEther("1000");
                await testToken.connect(liquidityProvider).approve(poolAddress, amount);
                await pool.connect(liquidityProvider).addLiquidity(amount);

                // Pause pool through factory
                await factory.pause();

                // Emergency withdraw must be called through factory
                const beforeBalance = await testToken.balanceOf(platformWallet.address);
                await factory.emergencyWithdrawFromPool(await testToken.getAddress());
                const afterBalance = await testToken.balanceOf(platformWallet.address);

                expect(afterBalance - beforeBalance).to.equal(amount);
                expect(await pool.totalDeposits()).to.equal(0);
                expect(await pool.totalShares()).to.equal(0);
            });
        });
    });

    describe("Router Tests", function () {
        it("Should handle multi-pool deposits correctly", async function () {
            const depositAmount = ethers.parseEther("100");
            
            // Approve router for both tokens
            const routerAddress = await router.getAddress();
            const testTokenAddress = await testToken.getAddress();
            const testToken2Address = await testToken2.getAddress();

            await testToken.connect(player).approve(routerAddress, depositAmount);
            await testToken2.connect(player).approve(routerAddress, depositAmount);
            
            // Deposit to both pools
            await router.connect(player).depositToPool(testTokenAddress, depositAmount);
            await router.connect(player).depositToPool(testToken2Address, depositAmount);
            
            // Verify deposits in both pools
            const [, pool1Address] = await factory.getPool(testTokenAddress);
            const [, pool2Address] = await factory.getPool(testToken2Address);
            const TokenPool = await ethers.getContractFactory("TokenPool");
            const pool1 = TokenPool.attach(pool1Address);
            const pool2 = TokenPool.attach(pool2Address);
            
            const platformFee = depositAmount * 500n / 10000n; // 5% fee
            const expectedDeposit = depositAmount - platformFee;
            
            expect(await pool1.getPoolBalance()).to.equal(expectedDeposit);
            expect(await pool2.getPoolBalance()).to.equal(expectedDeposit);
        });

        it("Should check active pools correctly", async function () {
            const depositAmount = ethers.parseEther("100");
            
            // Deposit to first pool only
            const routerAddress = await router.getAddress();
            const testTokenAddress = await testToken.getAddress();
            const testToken2Address = await testToken2.getAddress();

            await testToken.connect(player).approve(routerAddress, depositAmount);
            await router.connect(player).depositToPool(testTokenAddress, depositAmount);
            
            // Check active pools
            const hasBalance = await router.hasActivePools([testTokenAddress, testToken2Address]);
            expect(hasBalance).to.be.true;
            
            // Get specific balances
            const balances = await router.getPoolBalances([testTokenAddress, testToken2Address]);
            const platformFee = depositAmount * 500n / 10000n;
            const expectedDeposit = depositAmount - platformFee;
            
            expect(balances[0]).to.equal(expectedDeposit);
            expect(balances[1]).to.equal(0);
        });

        it("Should handle withdrawals from multiple pools", async function () {
            const depositAmount = ethers.parseEther("100");
            const withdrawAmount = ethers.parseEther("50");
            
            // Setup deposits in both pools
            const routerAddress = await router.getAddress();
            const testTokenAddress = await testToken.getAddress();
            const testToken2Address = await testToken2.getAddress();

            await testToken.connect(player).approve(routerAddress, depositAmount);
            await testToken2.connect(player).approve(routerAddress, depositAmount);
            await router.connect(player).depositToPool(testTokenAddress, depositAmount);
            await router.connect(player).depositToPool(testToken2Address, depositAmount);
            
            // Withdraw from both pools
            await router.connect(player).withdrawFromPool(
                testTokenAddress,
                withdrawAmount
            );
            await router.connect(player).withdrawFromPool(
                testToken2Address,
                withdrawAmount
            );
            
            // Verify balances
            const balances = await router.getPoolBalances([testTokenAddress, testToken2Address]);
            const platformFee = depositAmount * 500n / 10000n;
            const expectedBalance = depositAmount - platformFee - withdrawAmount;
            
            expect(balances[0]).to.equal(expectedBalance);
            expect(balances[1]).to.equal(expectedBalance);
        });

        it("Should handle errors correctly", async function () {
            const depositAmount = ethers.parseEther("100");
            
            // Try to deposit to non-existent pool
            await expect(
                router.connect(player).depositToPool(ethers.ZeroAddress, depositAmount)
            ).to.be.revertedWithCustomError(router, "PoolDoesNotExist");
            
            // Try to withdraw from non-existent pool
            const withdrawAmount = ethers.parseEther("100");
            await expect(
                router.connect(player).withdrawFromPool(
                    ethers.ZeroAddress,
                    withdrawAmount
                )
            ).to.be.revertedWithCustomError(router, "PoolDoesNotExist");
        });
    });
});
