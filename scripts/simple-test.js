const { ethers } = require('ethers');
const admin = require('firebase-admin');

async function runSimpleTest() {
    console.log('Starting simple integration test...\n');

    try {
        // Connect to local blockchain
        const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
        
        // Use the predefined accounts from ganache
        const operatorWallet = new ethers.Wallet('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', provider);
        const userWallet = new ethers.Wallet('0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890', provider);
        
        console.log('Deploying contracts...');

        // Deploy TestToken
        const TestTokenArtifact = require('../artifacts/contracts/TestToken.sol/TestToken.json');
        const TestToken = new ethers.ContractFactory(
            TestTokenArtifact.abi,
            TestTokenArtifact.bytecode,
            operatorWallet
        );
        const testToken = await TestToken.deploy();
        await testToken.deployed();
        console.log('TestToken deployed to:', testToken.address);

        // Deploy Factory
        const FactoryArtifact = require('../artifacts/contracts/CasinoFactory.sol/CasinoFactory.json');
        const Factory = new ethers.ContractFactory(
            FactoryArtifact.abi,
            FactoryArtifact.bytecode,
            operatorWallet
        );
        const factory = await Factory.deploy();
        await factory.deployed();
        console.log('Factory deployed to:', factory.address);

        // Initialize Factory
        await factory.initialize(operatorWallet.address);
        await factory.setOperator(operatorWallet.address, true, "test-operator");
        console.log('Factory initialized');

        // Create pool
        await factory.createPool(testToken.address);
        const [exists, poolAddress] = await factory.getPool(testToken.address);
        console.log('Pool created at:', poolAddress);

        // Get pool contract
        const TokenPoolArtifact = require('../artifacts/contracts/TokenPool.sol/TokenPool.json');
        const pool = new ethers.Contract(poolAddress, TokenPoolArtifact.abi, provider);

        // Initialize Firebase (using service account from your existing .env)
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: "trollslots",
                    clientEmail: "firebase-adminsdk-zbglg@trollslots.iam.gserviceaccount.com",
                    privateKey: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC3wqCb9gcx7Y/m\nzmTiJY/XVZjluVNOM5c4P/cH2Gpp0n9s8hJC2D/kKj6WprKcGA7BqROsrbVfpv70\nsAJSdxqka6KxfdxcieoVwZZLdEWM0erElYVk3HiIswUwMq+kXb70LTLrcgdQUbST\nKpr2sO49MEnviH+9iURBtsvOykrmqlXGQ8zvxsoyikN7+LBK54eV0ZHJB7cotsBz\n8bDV0wUiY6O3AQC8LDyQwKxUV15VzHC9apGuCgog2bRmGmENxzZ5VHs80hCC0mrX\nl1d88+rJO9hyzn5feJ6fQJCzsoYCxqkBWUHJtX0CTeYjFzLUh7DJH5/r3o4MAelX\nSRMwvEEhAgMBAAECggEACsxB+cgkNhfai9p27R79685Y1K7mKUM40JJZprldz2gS\nGsnCrvDcGEEvOlUDS87SFykjQdNXRA6hDqnFCSl8hEra3YkiyMFF4w9kEHz9lT/E\nhtauZvXZk1bJqEJiNctYbCq3wkQKD/stHDS1tGdDKI9M2OlxcCa/vwjJwxX5/sHM\nA3rKo2w+sAZq5DojEJau2k+3jB74n50TKlt6AuPYikwWRgy/knUoxEwG7Yb9/GBu\nOtpslD70MjKZ3Qe0PNhNiy2bHBaFOj0I5zevPzJEoVycpL+ER7kJEp/YMWJahhmm\nqZa8qd7reLOHO4FjbpL5zsfZ3pKGUkxE4w6h1xzArQKBgQDrRSaAcE/VimVqDjOj\n/X97HpzvWgdmTxELcQuqwlK+3U7HjyQLrOsUUo6+v4+CVKpySnThqDPqN5SgaEKF\nCw7fCpdhW4mSf/m3CXS527O+V2aGGFhM3LPHHIpiOaHr2BhiGWvtNw54qaHgIZ/D\n5Yk75JRRKNx3gIGcEM5WqECohwKBgQDH85l39YjDlFO4eu4caGmdYlxUiMJxhILj\nYgzBP7ee34fTcDAT5BAVM05/dazV/z5ny4dw9XKllbkCM1GgR0mh/KfPP18jwJ5k\nroUaR99USd1ucuoPQnclC2RtjC0xb7zq4ww5nA2iL6f5CmZJYIIe44DT4rDteXJl\nYm5x9ro7FwKBgBgGA5xx23UOoLRnptZD+FR2F8hJBSBpSnBEptBU72YV6wltkFyw\n14BHvdO0c873HkB1YeH47vQnoMGQY9p5+pbD2hlS44VWFAWgrY6c5Im3GvzuV3Xh\nw2m9fFPzVplig3rg5ahfStb/W0wrosi6E31OJebzqS96q8Fn5enrXE7ZAoGBAIPq\nNbTLu5f0sqtCBvec9xjLPMjUlRvZZZToKiwQgm8BYBXhrQZiby3ddItoskdYpu5J\ne6jNdf7CYZWPD+ojPfPtwTRcxcLLoHQiI1QsWK2+MaVdkQfSPNKmynHvih1Ub5mz\ng2w6hVAcCsCl2MfOMOp6A5NGup1hg1RZ9S2grkqvAoGBAMbC+NCvIVn5E6j+RQZQ\n/NKBQqjkceyU1Ej2qEvTraut7JYTaoXVqY06pA/BDPWj5rPW69RmtLAeJ+erecva\npcp5tV/23FjWrsj4gJhYIzthJXXch8ePuv2UZPxAVE8WuXWDeG8xkOc7woMuBduc\nRbIy7s+gSRdPGJsqPUFtKVgo\n-----END PRIVATE KEY-----\n".replace(/\\n/g, '\n')
                })
            });
        }

        // Test 1: Mint and Deposit
        console.log('\nTest 1: Mint and Deposit');
        const mintAmount = ethers.utils.parseEther("100");
        await testToken.mint(userWallet.address, mintAmount);
        console.log('✓ Tokens minted to user');

        // Approve and deposit
        const tokenWithUser = testToken.connect(userWallet);
        await tokenWithUser.approve(poolAddress, mintAmount);
        const poolWithUser = pool.connect(userWallet);
        await poolWithUser.deposit(ethers.utils.parseEther("50"));
        console.log('✓ Deposit successful');

        // Update Firebase balance
        const userBalanceRef = admin.firestore()
            .collection('balances')
            .doc(userWallet.address);
        
        await userBalanceRef.set({
            balance: "50",
            token: testToken.address,
            lastUpdate: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('✓ Firebase balance updated');

        // Test 2: Withdrawal
        console.log('\nTest 2: Withdrawal');
        const withdrawAmount = ethers.utils.parseEther("20");
        
        // Create withdrawal signature
        const blockNumber = await provider.getBlockNumber();
        const withdrawalHash = ethers.utils.solidityKeccak256(
            ['address', 'uint256', 'uint256'],
            [userWallet.address, withdrawAmount, blockNumber]
        );
        const signature = await operatorWallet.signMessage(ethers.utils.arrayify(withdrawalHash));
        
        // Execute withdrawal
        await poolWithUser.withdraw(withdrawAmount, signature);
        console.log('✓ Withdrawal successful');

        // Update Firebase balance
        await userBalanceRef.update({
            balance: "30",
            lastUpdate: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('✓ Firebase balance updated after withdrawal');

        console.log('\nAll tests completed successfully! ✨');

    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
}

// Run test
if (require.main === module) {
    runSimpleTest().catch(console.error);
}

module.exports = runSimpleTest;
