const { ethers } = require('ethers');
const admin = require('firebase-admin');
require('dotenv').config();

class OperatorService {
    constructor(privateKey, factoryAddress, providerUrl) {
        // Setup provider and wallet
        this.provider = new ethers.providers.JsonRpcProvider(providerUrl);
        this.wallet = new ethers.Wallet(privateKey, this.provider);
        this.factoryAddress = factoryAddress;

        // Initialize Firebase
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    // WARNING: Private key should be stored securely, not in code
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
                })
            });
        }
        this.db = admin.firestore();
    }

    async start() {
        console.log('Starting operator service...');
        
        // Listen for balance changes in Firebase
        this.db.collection('balances').onSnapshot(async (snapshot) => {
            for (const change of snapshot.docChanges()) {
                if (change.type === 'modified') {
                    await this.handleBalanceChange(change.doc.id, change.doc.data());
                }
            }
        }, error => {
            console.error('Firebase listener error:', error);
        });

        console.log('Operator service started');
    }

    async handleBalanceChange(userAddress, balanceData) {
        try {
            const blockNumber = await this.provider.getBlockNumber();
            
            // Create balance hash
            const messageHash = ethers.utils.solidityKeccak256(
                ['address', 'uint256', 'uint256'],
                [userAddress, balanceData.balance, blockNumber]
            );
            
            // Sign the hash
            const signature = await this.wallet.signMessage(
                ethers.utils.arrayify(messageHash)
            );

            // Get pool address from factory
            const factory = await this.getFactoryContract();
            const [exists, poolAddress] = await factory.getPool(balanceData.token);
            
            if (!exists) {
                console.error(`No pool found for token ${balanceData.token}`);
                return;
            }

            // Update balance on chain
            const pool = await this.getPoolContract(poolAddress);
            const tx = await pool.updateFirebaseBalance(
                userAddress,
                ethers.utils.parseUnits(balanceData.balance.toString(), 18),
                signature
            );
            
            await tx.wait();
            console.log(`Updated balance for ${userAddress}: ${balanceData.balance}`);
            
        } catch (error) {
            console.error('Error handling balance change:', error);
        }
    }

    async signWithdrawal(userAddress, amount) {
        const blockNumber = await this.provider.getBlockNumber();
        
        // Create withdrawal hash
        const messageHash = ethers.utils.solidityKeccak256(
            ['address', 'uint256', 'uint256'],
            [userAddress, amount, blockNumber]
        );
        
        // Sign the hash
        return await this.wallet.signMessage(ethers.utils.arrayify(messageHash));
    }

    async getFactoryContract() {
        const factoryAbi = [
            "function getPool(address token) view returns (bool exists, address pool)",
            "function operators(address) view returns (bool)"
        ];
        return new ethers.Contract(this.factoryAddress, factoryAbi, this.wallet);
    }

    async getPoolContract(poolAddress) {
        const poolAbi = [
            "function updateFirebaseBalance(address user, uint256 balance, bytes memory signature) external",
            "function firebaseBalances(address) view returns (uint256)",
            "function lastBalanceUpdate(address) view returns (uint256)"
        ];
        return new ethers.Contract(poolAddress, poolAbi, this.wallet);
    }
}

// Example usage:
async function main() {
    const operatorService = new OperatorService(
        process.env.OPERATOR_PRIVATE_KEY,
        process.env.FACTORY_ADDRESS,
        process.env.PROVIDER_URL
    );

    await operatorService.start();

    // Keep the process running
    process.on('SIGINT', async () => {
        console.log('Shutting down operator service...');
        process.exit(0);
    });
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = OperatorService;
