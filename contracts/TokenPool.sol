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

    // Constants
    uint256 private constant BASIS_POINTS = 10000;
    uint256 private constant MAX_FEE = 1000; // 10% max

    // Fee settings
    uint256 public platformFee; // default 5% = 500
    uint256 public gameFee;     // default 5% = 500

    // Core state
    IERC20 public token;
    ICasinoFactory public factory;
    address public platformWallet;
    uint256 public totalDeposits;

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

        // Default fees
        platformFee = 500; // 5%
        gameFee = 500;     // 5%

        // Transfer ownership to factory
        transferOwnership(_factory);
    }

    // ------------------------------------
    // Liquidity Management (Optional)
    // ------------------------------------
    function addLiquidity(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();

        uint256 newShares;
        if (totalShares == 0) {
            newShares = amount;
        } else {
            newShares = (amount * totalShares) / totalDeposits;
        }

        rewardDebt[msg.sender] = (newShares * accRewardPerShare) / 1e12;
        token.safeTransferFrom(msg.sender, address(this), amount);

        totalDeposits += amount;
        totalShares += newShares;
        shares[msg.sender] += newShares;

        emit LiquidityAdded(msg.sender, amount, newShares, block.timestamp);
    }

    function removeLiquidity(uint256 shareAmount) external nonReentrant {
        if (shareAmount == 0) revert InvalidAmount();
        if (shareAmount > shares[msg.sender]) revert InsufficientShares();

        _harvestRewards(msg.sender);

        uint256 tokenAmount = (shareAmount * totalDeposits) / totalShares;
        totalDeposits -= tokenAmount;
        totalShares -= shareAmount;
        shares[msg.sender] -= shareAmount;

        rewardDebt[msg.sender] = (shares[msg.sender] * accRewardPerShare) / 1e12;

        token.safeTransfer(msg.sender, tokenAmount);

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
            accumulatedFees -= pending;
            token.safeTransfer(provider, pending);
            emit RewardsClaimed(provider, pending, block.timestamp);
        }
        rewardDebt[provider] = (userTotal * accRewardPerShare) / 1e12;
    }

    // ------------------------------------
    // Game Result Logic
    // ------------------------------------
    function processGameResult(
        address user,
        uint256 betAmount,
        uint256 winAmount
    ) external {
        // Must be from an operator or the owner
        // Fix bracket mismatch: ( ) not ]
        if (!factory.operators(msg.sender) && msg.sender != factory.owner()) {
            revert NotAuthorized();
        }

        if (winAmount > 0) {
            // house fee on winnings
            uint256 houseFee = (winAmount * gameFee) / BASIS_POINTS;
            uint256 netWin = winAmount - houseFee;

            // distribute fee as reward
            accumulatedFees += houseFee;
            if (totalShares > 0) {
                accRewardPerShare += (houseFee * 1e12) / totalShares;
            }

            if (netWin > totalDeposits) revert InsufficientBalance();
            token.safeTransfer(user, netWin);

            // pool effectively loses (winAmount - houseFee)
            totalDeposits = totalDeposits - winAmount + houseFee;

            emit GameResult(user, betAmount, winAmount, houseFee, block.timestamp);
        } else {
            // user lost => bet is gained by the pool
            totalDeposits += betAmount;
            emit GameResult(user, betAmount, 0, betAmount, block.timestamp);
        }
    }

    // ------------------------------------
    // Platform Fee
    // ------------------------------------
    function setPlatformFee(uint256 newFee) external onlyOwner {
        if (newFee > MAX_FEE) revert FeeTooHigh();
        uint256 oldFee = platformFee;
        platformFee = newFee;
        emit PlatformFeeUpdated(oldFee, newFee);
    }

    // ------------------------------------
    // Deposit / Withdraw
    // ------------------------------------
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();

        uint256 feeAmount = (amount * platformFee) / BASIS_POINTS;
        uint256 netAmount = amount - feeAmount;

        token.safeTransferFrom(msg.sender, address(this), amount);
        if (feeAmount > 0) {
            token.safeTransfer(platformWallet, feeAmount);
        }
        totalDeposits += netAmount;

        emit Deposit(msg.sender, amount, netAmount, block.timestamp);
    }

    function withdraw(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (amount > totalDeposits) revert InsufficientBalance();

        uint256 feeAmount = (amount * platformFee) / BASIS_POINTS;
        uint256 netAmount = amount - feeAmount;

        totalDeposits -= amount;

        if (feeAmount > 0) {
            token.safeTransfer(platformWallet, feeAmount);
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
