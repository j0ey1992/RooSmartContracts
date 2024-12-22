// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./security/Pausable.sol";
import "./access/Ownable.sol";
import "./utils/ReentrancyGuard.sol";
import "./interfaces/IERC20.sol";
import "./token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ICasinoFactory.sol";
import "./errors/CasinoErrors.sol";

/**
 * @title TokenPool
 * @dev Manages deposits, withdrawals, and liquidity for casino tokens
 */
contract TokenPool is Pausable, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Constants
    uint256 private constant BASIS_POINTS = 10000;
    uint256 private constant MAX_FEE = 1000; // 10% max
    uint256 private constant BALANCE_EXPIRY_BLOCKS = 5760; // ~24 hours at 15s/block

    // Fee settings
    uint256 public constant LP_FEE = 250;        // 2.5% fee for adding/removing liquidity
    uint256 public constant GAME_LP_FEE = 200;   // 2% of each bet goes to LPs
    uint256 public constant GAME_PLATFORM_FEE = 100; // 1% of each bet goes to platform
    address public constant PLATFORM_WALLET = 0x1db597fE69BA45c0dd0E3DBE1919231e44B2d402;

    // Core state
    IERC20 public token;
    ICasinoFactory public factory;
    address public platformWallet;
    uint256 public totalDeposits;

    // Firebase balance tracking
    mapping(address => uint256) public firebaseBalances;
    mapping(address => uint256) public lastBalanceUpdate;
    mapping(address => uint256) public balanceNonces;

    // Liquidity
    uint256 public totalShares;
    uint256 public accumulatedFees;
    mapping(address => uint256) public shares;
    mapping(address => uint256) public rewardDebt;
    uint256 public accRewardPerShare;

    // Events
    event Deposit(address indexed user, uint256 amount, uint256 netAmount, uint256 timestamp);
    event Withdrawal(address indexed user, uint256 amount, uint256 netAmount, uint256 timestamp);
    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event LiquidityAdded(address indexed provider, uint256 amount, uint256 shares, uint256 timestamp);
    event LiquidityRemoved(address indexed provider, uint256 amount, uint256 shares, uint256 timestamp);
    event RewardsClaimed(address indexed provider, uint256 amount, uint256 timestamp);
    event GameResult(address indexed user, uint256 betAmount, uint256 winAmount, uint256 houseFee, uint256 timestamp);
    event FirebaseBalanceUpdated(address indexed user, uint256 balance, uint256 blockNumber);

    constructor(
        address _token,
        address _factory,
        address _platformWallet
    ) Ownable(_factory) {
        if (_token == address(0)) revert InvalidAmount();
        if (_factory == address(0)) revert InvalidAmount();
        if (_platformWallet == address(0)) revert InvalidAmount();

        token = IERC20(_token);
        factory = ICasinoFactory(_factory);
        platformWallet = _platformWallet;

        // No default fees needed - using constants

        // Transfer ownership to factory
        transferOwnership(_factory);
    }

    /**
     * @dev Pause the pool
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause the pool
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ------------------------------------
    // Firebase Balance Management
    // ------------------------------------
    
    // Struct for batch balance updates
    struct BalanceUpdate {
        address user;
        uint256 balance;
        uint256 nonce;
    }

    event BatchBalanceUpdate(address[] users, uint256[] balances, uint256[] nonces);

    /**
     * @dev Update a single user's Firebase balance
     */
    function updateFirebaseBalance(
        address user,
        uint256 balance,
        uint256 nonce
    ) external {
        if (!factory.operators(msg.sender)) revert NotAuthorized();
        if (nonce <= balanceNonces[user]) revert InvalidNonce();
        
        _updateBalance(user, balance, nonce);
    }

    /**
     * @dev Batch update multiple users' Firebase balances
     */
    function batchUpdateFirebaseBalances(BalanceUpdate[] calldata updates) external {
        if (!factory.operators(msg.sender)) revert NotAuthorized();
        if (updates.length == 0) revert EmptyUpdates();
        
        address[] memory users = new address[](updates.length);
        uint256[] memory balances = new uint256[](updates.length);
        uint256[] memory nonces = new uint256[](updates.length);

        for (uint256 i = 0; i < updates.length; i++) {
            BalanceUpdate memory update = updates[i];
            if (update.nonce <= balanceNonces[update.user]) revert InvalidNonce();
            
            _updateBalance(update.user, update.balance, update.nonce);
            
            users[i] = update.user;
            balances[i] = update.balance;
            nonces[i] = update.nonce;
        }

        emit BatchBalanceUpdate(users, balances, nonces);
    }

    /**
     * @dev Internal function to update a user's balance
     */
    function _updateBalance(address user, uint256 balance, uint256 nonce) internal {
        firebaseBalances[user] = balance;
        lastBalanceUpdate[user] = block.number;
        balanceNonces[user] = nonce;
        
        emit FirebaseBalanceUpdated(user, balance, block.number);
    }

    // ------------------------------------
    // Liquidity Management
    // ------------------------------------
    function addLiquidity(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();

        // Calculate platform fee (2.5%)
        uint256 platformFeeAmount = (amount * LP_FEE) / BASIS_POINTS;
        uint256 netAmount = amount - platformFeeAmount;

        uint256 newShares;
        if (totalShares == 0) {
            newShares = netAmount;
        } else {
            // Calculate shares based on net amount
            newShares = (netAmount * totalShares) / totalDeposits;
        }

        // Transfer tokens
        token.safeTransferFrom(msg.sender, address(this), amount);
        
        // Send platform fee
        if (platformFeeAmount > 0) {
            token.safeTransfer(PLATFORM_WALLET, platformFeeAmount);
        }
        
        // Update state with net amount
        totalDeposits += netAmount;
        totalShares += newShares;
        shares[msg.sender] += newShares;
        
        // Initialize reward debt based on current accumulated rewards
        rewardDebt[msg.sender] = (newShares * accRewardPerShare) / 1e12;

        emit LiquidityAdded(msg.sender, amount, newShares, block.timestamp);
    }

    function removeLiquidity(uint256 shareAmount) external nonReentrant {
        if (shareAmount == 0) revert InvalidAmount();
        if (shareAmount > shares[msg.sender]) revert InsufficientShares();

        // Claim any pending rewards first
        _harvestRewards(msg.sender);

        // Calculate token amount based on shares
        uint256 tokenAmount = (shareAmount * totalDeposits) / totalShares;

        // Calculate platform fee (2.5%)
        uint256 platformFeeAmount = (tokenAmount * LP_FEE) / BASIS_POINTS;
        uint256 netAmount = tokenAmount - platformFeeAmount;

        // Update state
        totalDeposits -= tokenAmount;
        totalShares -= shareAmount;
        shares[msg.sender] -= shareAmount;
        rewardDebt[msg.sender] = (shares[msg.sender] * accRewardPerShare) / 1e12;

        // Send platform fee
        if (platformFeeAmount > 0) {
            token.safeTransfer(PLATFORM_WALLET, platformFeeAmount);
        }

        // Send net amount to user
        token.safeTransfer(msg.sender, netAmount);

        emit LiquidityRemoved(msg.sender, tokenAmount, shareAmount, block.timestamp);
    }

    function claimRewards() external nonReentrant {
        _harvestRewards(msg.sender);
    }

    function _harvestRewards(address provider) internal {
        uint256 userTotal = shares[provider];
        if (userTotal == 0) return;

        uint256 pending = (userTotal * accRewardPerShare) / 1e12 - rewardDebt[provider];
        if (pending > 0) {
            // Calculate platform's 1% of rewards
            uint256 platformFeeAmount = (pending * GAME_PLATFORM_FEE) / BASIS_POINTS;
            uint256 netRewards = pending - platformFeeAmount;

            // Update state
            accumulatedFees -= pending;
            rewardDebt[provider] = (userTotal * accRewardPerShare) / 1e12;

            // Send platform fee
            if (platformFeeAmount > 0) {
                token.safeTransfer(PLATFORM_WALLET, platformFeeAmount);
            }

            // Send net rewards to provider
            token.safeTransfer(provider, netRewards);
            emit RewardsClaimed(provider, netRewards, block.timestamp);
        }
    }

    // ------------------------------------
    // Game Result Logic
    // ------------------------------------
    function processGameResult(
        address user,
        uint256 betAmount,
        uint256 winAmount
    ) external {
        if (!factory.operators(msg.sender) && msg.sender != factory.owner()) {
            revert NotAuthorized();
        }

        // Verify and update Firebase balance for bet
        if (betAmount > firebaseBalances[user]) revert InsufficientBalance();
        firebaseBalances[user] -= betAmount;
        balanceNonces[user] = balanceNonces[user] + 1;

        if (winAmount > 0) {
            // Calculate fees on winnings (2% LP + 1% platform)
            uint256 totalFee = (winAmount * (GAME_LP_FEE + GAME_PLATFORM_FEE)) / BASIS_POINTS;
            uint256 platformFeeAmount = (winAmount * GAME_PLATFORM_FEE) / BASIS_POINTS;
            uint256 lpFee = (winAmount * GAME_LP_FEE) / BASIS_POINTS;
            uint256 netWin = winAmount - totalFee;

            // Update rewards for LPs
            accumulatedFees += lpFee;
            if (totalShares > 0) {
                accRewardPerShare += (lpFee * 1e12) / totalShares;
            }

            if (netWin > totalDeposits) revert InsufficientBalance();
            
            // Add net winnings to Firebase balance
            firebaseBalances[user] += netWin;
            
            // Transfer winnings and fees
            token.safeTransfer(user, netWin);
            token.safeTransfer(PLATFORM_WALLET, platformFeeAmount);
            totalDeposits = totalDeposits - winAmount + lpFee;

            emit GameResult(user, betAmount, winAmount, lpFee, block.timestamp);
        } else {
            // On loss, calculate fees (2% LP + 1% platform)
            uint256 platformFeeAmount = (betAmount * GAME_PLATFORM_FEE) / BASIS_POINTS;
            uint256 lpFee = (betAmount * GAME_LP_FEE) / BASIS_POINTS;
            uint256 poolAmount = betAmount - platformFeeAmount - lpFee;
            
            // Update rewards for LPs
            accumulatedFees += lpFee;
            if (totalShares > 0) {
                accRewardPerShare += (lpFee * 1e12) / totalShares;
            }

            // Update pool balance and send platform fee
            totalDeposits += poolAmount;
            token.safeTransfer(PLATFORM_WALLET, platformFeeAmount);

            emit GameResult(user, betAmount, 0, lpFee, block.timestamp);
        }

        // Update last balance update time and emit event
        lastBalanceUpdate[user] = block.number;
        emit FirebaseBalanceUpdated(user, firebaseBalances[user], block.number);
    }

    // ------------------------------------
    // Deposit / Withdraw
    // ------------------------------------
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();

        // Transfer tokens from sender
        token.safeTransferFrom(msg.sender, address(this), amount);
        
        // Update balances
        totalDeposits += amount;
        firebaseBalances[msg.sender] += amount;
        lastBalanceUpdate[msg.sender] = block.number;
        balanceNonces[msg.sender] = balanceNonces[msg.sender] + 1;

        emit Deposit(msg.sender, amount, amount, block.timestamp);
        emit FirebaseBalanceUpdated(msg.sender, firebaseBalances[msg.sender], block.number);
    }

    function depositFor(address user, uint256 amount) external nonReentrant whenNotPaused {
        // Only router can deposit for other users
        if (msg.sender != factory.router()) revert NotAuthorized();

        if (amount == 0) revert InvalidAmount();

        // Update balances
        totalDeposits += amount;
        firebaseBalances[user] += amount;
        lastBalanceUpdate[user] = block.number;
        balanceNonces[user] = balanceNonces[user] + 1;

        emit Deposit(user, amount, amount, block.timestamp);
        emit FirebaseBalanceUpdated(user, firebaseBalances[user], block.number);
    }

    /**
     * @dev Withdraw with Firebase balance verification
     */
    function withdraw(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();

        // Verify Firebase balance first
        if (amount > firebaseBalances[msg.sender]) revert ExceedsFirebaseBalance();
        if (block.number - lastBalanceUpdate[msg.sender] > BALANCE_EXPIRY_BLOCKS) revert BalanceProofExpired();

        // Then check pool balance
        if (amount > totalDeposits) revert InsufficientBalance();

        // Calculate platform fee (2.5%)
        uint256 platformFeeAmount = (amount * LP_FEE) / BASIS_POINTS;
        uint256 netAmount = amount - platformFeeAmount;

        // Update balances
        firebaseBalances[msg.sender] -= amount;
        totalDeposits -= amount;

        // Send platform fee and net amount
        if (platformFeeAmount > 0) {
            token.safeTransfer(PLATFORM_WALLET, platformFeeAmount);
        }
        token.safeTransfer(msg.sender, netAmount);

        emit Withdrawal(msg.sender, amount, netAmount, block.timestamp);
    }

    // ------------------------------------
    // View Helpers
    // ------------------------------------
    function getPoolBalance() external view returns (uint256) {
        return totalDeposits;
    }

    function getPendingRewards(address provider) external view returns (uint256) {
        uint256 userShares = shares[provider];
        if (userShares == 0) return 0;
        return (userShares * accRewardPerShare) / 1e12 - rewardDebt[provider];
    }

    // ------------------------------------
    // Emergency Admin
    // ------------------------------------
    function emergencyWithdraw() external onlyOwner whenPaused {
        uint256 balance = token.balanceOf(address(this));
        if (balance > 0) {
            token.safeTransfer(platformWallet, balance);
        }
        totalDeposits = 0;
        totalShares = 0;
        accumulatedFees = 0;
        accRewardPerShare = 0;
    }

}
