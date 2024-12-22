const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

async function deployContracts() {
    console.log('Deploying contracts for testing...');

    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL);
        const deployer = new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY, provider);
        
        // Deploy TestToken
        console.log('Deploying TestToken...');
        const TestTokenArtifact = require('../artifacts/contracts/TestToken.sol/TestToken.json');
        const TestToken = new ethers.ContractFactory(
            TestTokenArtifact.abi,
            TestTokenArtifact.bytecode,
            deployer
        );
        const testToken = await TestToken.deploy();
        await testToken.deployed();
        console.log('TestToken deployed to:', testToken.address);

        // Deploy CasinoFactory
        console.log('Deploying CasinoFactory...');
        const FactoryArtifact = require('../artifacts/contracts/CasinoFactory.sol/CasinoFactory.json');
        const Factory = new ethers.ContractFactory(
            FactoryArtifact.abi,
            FactoryArtifact.bytecode,
            deployer
        );
        const factory = await Factory.deploy();
        await factory.deployed();
        console.log('CasinoFactory deployed to:', factory.address);

        // Initialize factory
        console.log('Initializing factory...');
        await factory.initialize(deployer.address); // Use deployer as platform wallet for testing
        await factory.setOperator(deployer.address, true, "test-operator");

        // Create pool for test token
        console.log('Creating pool for TestToken...');
        await factory.createPool(testToken.address);
        const [exists, poolAddress] = await factory.getPool(testToken.address);
        console.log('Pool created at:', poolAddress);

        // Mint test tokens to user wallet
        const userAddress = new ethers.Wallet(process.env.USER_PRIVATE_KEY).address;
        const mintAmount = ethers.utils.parseEther("1000");
        await testToken.mint(userAddress, mintAmount);
        console.log('Minted test tokens to user:', userAddress);

        // Update .env with deployed addresses
        const envPath = path.join(__dirname, '..', '.env');
        let envContent = fs.readFileSync(envPath, 'utf8');
        
        envContent = envContent.replace(
            /FACTORY_ADDRESS="[^"]*"/,
            `FACTORY_ADDRESS="${factory.address}"`
        );
        envContent = envContent.replace(
            /TEST_TOKEN_ADDRESS="[^"]*"/,
            `TEST_TOKEN_ADDRESS="${testToken.address}"`
        );
        
        fs.writeFileSync(envPath, envContent);
        console.log('Updated .env with deployed addresses');

        console.log('\nDeployment completed successfully! ✨');
        console.log('You can now run the integration tests.');

        return {
            testToken: testToken.address,
            factory: factory.address,
            pool: poolAddress
        };

    } catch (error) {
        console.error('Deployment failed:', error);
        process.exit(1);
    }
}

// Run deployment
if (require.main === module) {
    deployContracts().catch(console.error);
}

module.exports = deployContracts;
