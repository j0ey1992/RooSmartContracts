const { ethers } = require('ethers');
const admin = require('firebase-admin');
const OperatorService = require('./operator-service');
require('dotenv').config();

async function withdrawWinnings(userAddress, tokenAddress, amount) {
    try {
        // Initialize services
        const operatorService = new OperatorService(
            process.env.OPERATOR_PRIVATE_KEY,
            process.env.FACTORY_ADDRESS,
            process.env.PROVIDER_URL
        );

        // Get user's Firebase balance
        const balanceDoc = await admin.firestore()
            .collection('balances')
            .doc(userAddress)
            .get();

        if (!balanceDoc.exists) {
            throw new Error('No balance found for user');
        }

        const userData = balanceDoc.data();
        if (userData.balance < amount) {
            throw new Error('Insufficient balance');
        }

        // Get withdrawal signature from operator
        const signature = await operatorService.signWithdrawal(
            userAddress,
            ethers.utils.parseUnits(amount.toString(), 18)
        );

        // Setup contract interaction
        const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL);
        const userWallet = new ethers.Wallet(process.env.USER_PRIVATE_KEY, provider);

        // Get pool address from factory
        const factory = new ethers.Contract(
            process.env.FACTORY_ADDRESS,
            ["function getPool(address token) view returns (bool exists, address pool)"],
            provider
        );
        const [exists, poolAddress] = await factory.getPool(tokenAddress);
        
        if (!exists) {
            throw new Error('Pool not found for token');
        }

        // Get pool contract
        const pool = new ethers.Contract(
            poolAddress,
            [
                "function withdraw(uint256 amount, bytes memory signature) external",
                "function firebaseBalances(address) view returns (uint256)"
            ],
            userWallet
        );

        // Execute withdrawal
        console.log('Executing withdrawal...');
        const tx = await pool.withdraw(
            ethers.utils.parseUnits(amount.toString(), 18),
            signature
        );
        
        // Wait for transaction confirmation
        const receipt = await tx.wait();
        console.log('Withdrawal successful:', receipt.transactionHash);

        // Update Firebase balance
        const newBalance = userData.balance - amount;
        await admin.firestore()
            .collection('balances')
            .doc(userAddress)
            .update({
                balance: newBalance,
                lastUpdate: admin.firestore.FieldValue.serverTimestamp()
            });

        console.log('Firebase balance updated');
        return receipt.transactionHash;

    } catch (error) {
        console.error('Withdrawal failed:', error);
        throw error;
    }
}

// Example usage
async function main() {
    if (process.argv.length < 5) {
        console.log('Usage: node withdraw.js <userAddress> <tokenAddress> <amount>');
        process.exit(1);
    }

    const [,, userAddress, tokenAddress, amount] = process.argv;

    try {
        const txHash = await withdrawWinnings(userAddress, tokenAddress, parseFloat(amount));
        console.log(`Withdrawal successful! Transaction hash: ${txHash}`);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = withdrawWinnings;
