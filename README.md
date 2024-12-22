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

### CasinoRouter
A helper contract that provides convenient methods for users to interact with multiple pools, including:
- Multi-pool deposits
- Multi-pool withdrawals
- Pool balance checks
- Active pool verification

## Key Features

### Fee Management
- Platform Fee: Default 5% (500 basis points), configurable up to 10%
- Game Fee: Default 5% (500 basis points), configurable up to 10%
- Fees are collected on deposits, withdrawals, and game winnings
- Collected fees are distributed to liquidity providers

### Operator System
- Operators can be added/removed by the factory owner
- Each operator has an associated name for identification
- Operators can process game results
- Only authorized operators can interact with pools

### Liquidity Provision
- Users can provide liquidity to pools
- Liquidity providers earn fees from game operations
- Share-based system for tracking liquidity provision
- Rewards can be claimed at any time

### Security Features
- Pausable system for emergency situations
- Emergency withdrawal functionality
- Reentrancy protection
- Role-based access control
- Fee limits and validations

## Test Coverage

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
- Operator system for game processing
- Factory-controlled pool management

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
- Reentrancy guards on all value transfers
- Balance checks before withdrawals
- Fee limits to prevent excessive charges
- Safe transfer implementations

## Test Results
All 20 tests passing, covering:
- 4 Basic Integration Tests
- 6 Factory Tests
- 7 Pool Tests
- 3 Router Tests

Each test category verifies both happy paths and error cases, ensuring robust system behavior under various conditions.
