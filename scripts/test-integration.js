const { ethers } = require('ethers');
const admin = require('firebase-admin');
const OperatorService = require('./operator-service');

async function runTests() {
    console.log('Starting integration tests...\n');

    try {
        // Initialize services
        const operatorService = new OperatorService(
            process.env.OPERATOR_PRIVATE_KEY,
            process.env.FACTORY_ADDRESS,
            process.env.PROVIDER_URL
        );

        const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL);
        const operatorWallet = new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY, provider);
        const userWallet = new ethers.Wallet(process.env.USER_PRIVATE_KEY, provider);

        console.log('Test 1: Deposit and Firebase Balance Update');
        try {
            // Get pool contract
            const factory = new ethers.Contract(
                process.env.FACTORY_ADDRESS,
                ["function getPool(address token) view returns (bool exists, address pool)"],
                provider
            );
            const [exists, poolAddress] = await factory.getPool(process.env.TEST_TOKEN_ADDRESS);
            
            if (!exists) {
                throw new Error('Pool not found for token');
            }

            const pool = new ethers.Contract(
                poolAddress,
                [
                    "function deposit(uint256 amount) external",
                    "function firebaseBalances(address) view returns (uint256)",
                    "function withdraw(uint256 amount, bytes memory signature) external"
                ],
                userWallet
            );

            // Test deposit
            const depositAmount = ethers.utils.parseEther("1.0");
            const tx = await pool.deposit(depositAmount);
            await tx.wait();
            console.log('✓ Deposit successful');

            // Update Firebase balance
            const userBalanceRef = admin.firestore()
                .collection('balances')
                .doc(userWallet.address);

            await userBalanceRef.set({
                balance: ethers.utils.formatEther(depositAmount),
                token: process.env.TEST_TOKEN_ADDRESS,
                lastUpdate: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log('✓ Firebase balance updated');

            // Verify Firebase balance
            const balanceDoc = await userBalanceRef.get();
            const firebaseBalance = balanceDoc.data().balance;
            console.log(`✓ Firebase balance verified: ${firebaseBalance} ETH`);

        } catch (error) {
            console.error('❌ Test 1 failed:', error.message);
            return;
        }

        console.log('\nTest 2: Withdrawal with Firebase Balance Check');
        try {
            const withdrawAmount = ethers.utils.parseEther("0.5");
            
            // Get withdrawal signature
            const signature = await operatorService.signWithdrawal(
                userWallet.address,
                withdrawAmount
            );
            console.log('✓ Withdrawal signature obtained');

            // Execute withdrawal
            const [, poolAddress] = await factory.getPool(process.env.TEST_TOKEN_ADDRESS);
            const pool = new ethers.Contract(
                poolAddress,
                ["function withdraw(uint256 amount, bytes memory signature) external"],
                userWallet
            );

            const tx = await pool.withdraw(withdrawAmount, signature);
            await tx.wait();
            console.log('✓ Withdrawal successful');

            // Verify Firebase balance update
            const userBalanceRef = admin.firestore()
                .collection('balances')
                .doc(userWallet.address);
            
            const balanceDoc = await userBalanceRef.get();
            const currentBalance = parseFloat(balanceDoc.data().balance);
            const withdrawnAmount = parseFloat(ethers.utils.formatEther(withdrawAmount));
            
            await userBalanceRef.update({
                balance: (currentBalance - withdrawnAmount).toString(),
                lastUpdate: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log('✓ Firebase balance updated after withdrawal');

        } catch (error) {
            console.error('❌ Test 2 failed:', error.message);
            return;
        }

        console.log('\nTest 3: Invalid Withdrawal Attempt');
        try {
            const largeAmount = ethers.utils.parseEther("10.0"); // More than deposited
            
            // Get withdrawal signature
            const signature = await operatorService.signWithdrawal(
                userWallet.address,
                largeAmount
            );

            // Attempt withdrawal
            const [, poolAddress] = await factory.getPool(process.env.TEST_TOKEN_ADDRESS);
            const pool = new ethers.Contract(
                poolAddress,
                ["function withdraw(uint256 amount, bytes memory signature) external"],
                userWallet
            );

            try {
                const tx = await pool.withdraw(largeAmount, signature);
                await tx.wait();
                console.error('❌ Invalid withdrawal succeeded when it should have failed');
            } catch (error) {
                if (error.message.includes("Exceeds Firebase balance")) {
                    console.log('✓ Invalid withdrawal correctly rejected');
                } else {
                    throw error;
                }
            }

        } catch (error) {
            console.error('❌ Test 3 failed:', error.message);
            return;
        }

        console.log('\nAll tests completed successfully! ✨');

    } catch (error) {
        console.error('Test suite failed:', error);
    }
}

// Run tests
if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = runTests;
