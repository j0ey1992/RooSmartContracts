# Casino System Documentation

## Overview
The Casino System is a decentralized platform for managing token-based casino operations. It consists of multiple smart contracts working together to handle deposits, withdrawals, game results, liquidity provision, and emergency controls.

## Core Components

### CasinoFactory
The factory contract is the central hub for deploying and managing token pools. It handles:
- Pool deployment for different tokens
- Operator management
- Fee configuration
- Emergency controls
- Platform wallet management

### TokenPool
Individual pool contracts that manage token-specific operations including:
- User deposits and withdrawals
- Game result processing
- Liquidity provision
- Fee collection and distribution
- Emergency withdrawals
- Firebase balance verification

### CasinoRouter
A helper contract that provides convenient methods for users to interact with multiple pools, including:
- Multi-pool deposits
- Multi-pool withdrawals (with and without Firebase verification)
- Pool balance checks
- Active pool verification

## Key Features

### Firebase Integration
- Secure nonce-based balance verification system
- Authorized operator balance updates
- Balance expiry mechanism (24 hours)
- Batch update support for efficiency
- Double-spend protection through nonces

Example withdrawal process:
```javascript
// 1. Update Firebase balance through operator
await pool.updateFirebaseBalance(
    userAddress,
    balance,
    nonce // Must be greater than current nonce
);

// 2. Withdraw (requires valid Firebase balance)
await router.withdrawFromPool(
    tokenAddress,
    amount
);

// Optional: Batch update multiple balances
await pool.batchUpdateFirebaseBalances([
    { user: address1, balance: balance1, nonce: nonce1 },
    { user: address2, balance: balance2, nonce: nonce2 }
]);
```

Key Security Features:
- Users can only withdraw up to their verified Firebase balance
- Each balance update requires an incrementing nonce
- Balance proofs expire after 24 hours
- Only authorized operators can update balances
- Efficient batch processing for multiple users

### Fee Management
- Liquidity Provider Operations:
  - 2.5% fee for adding liquidity (goes to platform)
  - 2.5% fee for removing liquidity (goes to platform)
  - Example: 1000 USDC deposit costs 25 USDC platform fee

- Game Operations:
  - 2% of each bet goes to LP rewards
  - 1% of each bet goes to platform
  - Example: 100 USDC bet has:
    * 2 USDC to LP rewards pool
    * 1 USDC to platform

### Operator System
- Operators can be added/removed by the factory owner
- Each operator has an associated name for identification
- Operators can process game results and sign withdrawals
- Only authorized operators can interact with pools

### Liquidity Provision
- Users can provide liquidity to pools (2.5% platform fee)
- Share calculation based on current pool value:
  * newShares = (deposit * totalShares) / totalDeposits
  * Example: 200 USDC into 2970 USDC pool gets ~6% share
- Liquidity providers earn 2% from each bet
- Rewards system:
  * Accumulated rewards tracked per share
  * Platform takes 1% when rewards claimed
  * Rewards distributed proportionally to shares
  * Example: 1000 USDC in bets generates 20 USDC in LP rewards

### Security Features
- Nonce-based Firebase balance verification
- Incrementing nonce validation
- Balance expiry after 24 hours
- Pausable system for emergency situations
- Emergency withdrawal functionality
- Reentrancy protection
- Role-based access control
- Fee limits and validations
- Batch operation support

## Test Coverage

### Firebase Integration Tests
1. Balance Verification
   - Tests Firebase balance updates
   - Verifies nonce increments
   - Checks balance expiry
   - Tests invalid nonce handling
   - Validates batch updates

2. Withdrawal Security
   - Tests withdrawal limits
   - Verifies balance proofs
   - Checks nonce validation
   - Tests double-spend prevention
   - Validates batch processing

### Basic Integration Tests
1. Pool Creation and Configuration
   - Verifies pool deployment
   - Checks initial configuration
   - Validates token assignments

2. Deposit Functionality
   - Tests router-based deposits
   - Verifies fee calculations
   - Confirms balance updates

3. Game Result Processing
   - Tests winning scenarios
   - Tests losing scenarios
   - Verifies balance changes
   - Validates fee collection

4. Withdrawal System
   - Tests basic withdrawals
   - Tests signed withdrawals
   - Verifies fee deductions
   - Confirms balance updates

### Factory Tests
1. Initialization
   - Tests proper factory setup
   - Validates initial settings
   - Checks platform wallet configuration

2. Operator Management
   - Tests operator addition
   - Tests operator removal
   - Verifies operator permissions
   - Tests unauthorized access

3. Fee Management
   - Tests fee updates
   - Validates fee limits
   - Verifies pool fee synchronization
   - Tests invalid fee scenarios

4. Pool Management
   - Tests pool creation
   - Prevents duplicate pools
   - Validates pool tracking
   - Tests pool enumeration

5. Security Controls
   - Tests pause functionality
   - Tests unpause functionality
   - Verifies owner-only access
   - Tests platform wallet updates

### Pool Tests
1. Liquidity Management
   - Tests liquidity addition
   - Tests liquidity removal
   - Verifies share calculations
   - Tests reward distribution

2. Game Processing
   - Tests winning scenarios
   - Tests losing scenarios
   - Verifies operator permissions
   - Tests insufficient balance cases

3. Security Features
   - Tests emergency withdrawal
   - Verifies pause effects
   - Tests owner-only functions
   - Validates balance resets

### Router Tests
1. Multi-pool Operations
   - Tests multi-pool deposits
   - Tests multi-pool withdrawals
   - Verifies balance tracking
   - Tests pool existence checks

2. Error Handling
   - Tests non-existent pools
   - Validates input parameters
   - Tests insufficient balances
   - Verifies error messages

## Security Considerations

### Access Control
- Owner-only functions for critical operations
- Operator system for game processing and withdrawals
- Factory-controlled pool management

### Firebase Security
- Balance verification through nonce system
- Balance expiry mechanism
- Double-spend protection through nonces
- Batch update validation
- Strict operator authorization

### Emergency Controls
1. Pause Mechanism
   - Factory can pause all operations
   - Affects deposits and withdrawals
   - Prevents game processing
   - Allows emergency withdrawals

2. Emergency Withdrawal
   - Owner can trigger emergency withdrawals
   - Requires system to be paused
   - Sends all funds to platform wallet
   - Resets pool state

### Balance Protection
- Firebase balance verification
- Operator signature requirements
- Balance expiry after 24 hours
- Reentrancy guards on all value transfers
- Balance checks before withdrawals
- Fee limits to prevent excessive charges
- Safe transfer implementations

## Test Results
All tests passing, covering:
- 4 Firebase Integration Tests
- 4 Basic Integration Tests
- 6 Factory Tests
- 7 Pool Tests
- 3 Router Tests

Each test category verifies both happy paths and error cases, ensuring robust system behavior under various conditions.
