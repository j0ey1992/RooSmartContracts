// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./security/Pausable.sol";
import "./access/Ownable.sol";
import "./utils/ReentrancyGuard.sol";
import "./interfaces/IERC20.sol";
import "./token/ERC20/utils/SafeERC20.sol";

/**
 * @title RooCasino
 * @dev A casino system managing house pools, token deposits, and rewards distribution
 */
contract RooCasino is Pausable, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Constants
    uint256 private constant PLATFORM_FEE = 500; // 5% = 500 basis points
    uint256 private constant GAME_FEE = 500;     // 5%
    uint256 private constant MAX_BET_PERCENT = 100; // 1% = 100 basis points
    uint256 private constant BASIS_POINTS = 10000;

    // Structs
    struct HousePool {
        uint256 totalDeposits;                
        uint256 totalShares;                  
        mapping(address => uint256) shares;   
        mapping(address => uint256) rewards;  
    }

    // State Variables
    address public platformWallet;
    mapping(address => bool) public whitelistedTokens;
    mapping(address => bool) public trustedSources;
    mapping(address => HousePool) public housePools;
    mapping(address => mapping(address => bool)) private poolParticipants;
    mapping(address => address[]) private poolParticipantList;

    // Events
    event TokenWhitelisted(address indexed token, bool status);
    event TrustedSourceUpdated(address indexed source, bool status);
    event PlatformWalletUpdated(address indexed newWallet);
    event PoolDeposit(address indexed token, address indexed user, uint256 amount, uint256 shares);
    event PoolWithdrawal(address indexed token, address indexed user, uint256 amount, uint256 shares);
    event RewardDistributed(address indexed token, uint256 amount);
    event RewardClaimed(address indexed token, address indexed user, uint256 amount);
    event GameResult(address indexed token, uint256 betAmount, uint256 profitAmount, bool win);

    constructor(address _platformWallet) Ownable(msg.sender) {
        require(_platformWallet != address(0), "Invalid platform wallet");
        platformWallet = _platformWallet;
    }

    // Admin Functions
    function setTrustedSource(address source, bool status) external onlyOwner {
        require(source != address(0), "Invalid source address");
        trustedSources[source] = status;
        emit TrustedSourceUpdated(source, status);
    }

    function whitelistToken(address token, bool status) external onlyOwner {
        require(token != address(0), "Invalid token address");
        whitelistedTokens[token] = status;
        emit TokenWhitelisted(token, status);
    }

    function setPlatformWallet(address newWallet) external onlyOwner {
        require(newWallet != address(0), "Invalid wallet address");
        platformWallet = newWallet;
        emit PlatformWalletUpdated(newWallet);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // User Functions
    function deposit(address token, uint256 amount) external nonReentrant whenNotPaused {
        require(whitelistedTokens[token], "Token not whitelisted");
        require(amount > 0, "Amount must be greater than 0");

        HousePool storage pool = housePools[token];
        
        // Calculate platform fee
        uint256 platformFeeAmount = (amount * PLATFORM_FEE) / BASIS_POINTS;
        uint256 netAmount = amount - platformFeeAmount;

        // Calculate shares
        uint256 shares = pool.totalShares == 0 
            ? netAmount 
            : (netAmount * pool.totalShares) / pool.totalDeposits;
        
        require(shares > 0, "Deposit amount too small");

        // Transfer tokens
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        if (platformFeeAmount > 0) {
            IERC20(token).safeTransfer(platformWallet, platformFeeAmount);
        }

        // Update pool state
        pool.totalDeposits += netAmount;
        pool.totalShares += shares;
        pool.shares[msg.sender] += shares;
        _addPoolParticipant(token, msg.sender);

        emit PoolDeposit(token, msg.sender, amount, shares);
    }

    function withdraw(address token, uint256 shares) external nonReentrant whenNotPaused {
        require(whitelistedTokens[token], "Token not whitelisted");
        HousePool storage pool = housePools[token];
        require(shares > 0 && shares <= pool.shares[msg.sender], "Invalid shares amount");

        // Calculate withdrawal amount
        uint256 amount = (shares * pool.totalDeposits) / pool.totalShares;
        uint256 platformFeeAmount = (amount * PLATFORM_FEE) / BASIS_POINTS;
        uint256 netAmount = amount - platformFeeAmount;

        // Update pool state
        pool.totalDeposits -= amount;
        pool.totalShares -= shares;
        pool.shares[msg.sender] -= shares;
        _removePoolParticipant(token, msg.sender);

        // Transfer tokens
        if (platformFeeAmount > 0) {
            IERC20(token).safeTransfer(platformWallet, platformFeeAmount);
        }
        IERC20(token).safeTransfer(msg.sender, netAmount);

        emit PoolWithdrawal(token, msg.sender, amount, shares);
    }

    function claimRewards(address token) external nonReentrant whenNotPaused {
        HousePool storage pool = housePools[token];
        uint256 rewards = pool.rewards[msg.sender];
        require(rewards > 0, "No rewards to claim");

        pool.rewards[msg.sender] = 0;
        IERC20(token).safeTransfer(msg.sender, rewards);

        emit RewardClaimed(token, msg.sender, rewards);
    }

    // Game Functions
    function processGameResult(address token, uint256 betAmount, uint256 profitAmount, bool playerWon) 
        external 
        whenNotPaused 
    {
        require(trustedSources[msg.sender], "Not authorized");
        require(whitelistedTokens[token], "Token not whitelisted");
        
        HousePool storage pool = housePools[token];
        require(pool.totalDeposits > 0, "Pool is empty");
        
        // Verify bet is within limits
        uint256 maxBet = (pool.totalDeposits * MAX_BET_PERCENT) / BASIS_POINTS;
        require(betAmount <= maxBet, "Bet exceeds maximum");

        // Calculate game fee
        uint256 gameFeeAmount = (betAmount * GAME_FEE) / BASIS_POINTS;
        
        if (playerWon) {
            // House pays profit + returns bet => total is betAmount + profitAmount
            // For simplicity, no advanced logic for net results here
            // You could integrate more robust logic for fees or distributing profits
            require(betAmount + profitAmount <= pool.totalDeposits, "Insufficient pool funds");
            pool.totalDeposits -= (betAmount + profitAmount);
        } else {
            // House keeps bet minus game fee
            uint256 houseProfit = betAmount - gameFeeAmount;
            pool.totalDeposits += houseProfit;
        }

        emit GameResult(token, betAmount, profitAmount, playerWon);
    }

    // Internal
    function _addPoolParticipant(address token, address participant) internal {
        if (!poolParticipants[token][participant]) {
            poolParticipants[token][participant] = true;
            poolParticipantList[token].push(participant);
        }
    }

    function _removePoolParticipant(address token, address participant) internal {
        HousePool storage pool = housePools[token];
        if (pool.shares[participant] == 0 && poolParticipants[token][participant]) {
            poolParticipants[token][participant] = false;
            address[] storage participants = poolParticipantList[token];
            for (uint i = 0; i < participants.length; i++) {
                if (participants[i] == participant) {
                    participants[i] = participants[participants.length - 1];
                    participants.pop();
                    break;
                }
            }
        }
    }

    // View Functions
    function getMaxBet(address token) external view returns (uint256) {
        HousePool storage pool = housePools[token];
        return (pool.totalDeposits * MAX_BET_PERCENT) / BASIS_POINTS;
    }

    function getUserShares(address token, address user) external view returns (uint256) {
        return housePools[token].shares[user];
    }

    function getUserRewards(address token, address user) external view returns (uint256) {
        return housePools[token].rewards[user];
    }

    function getPoolInfo(address token) external view returns (
        uint256 totalDeposits,
        uint256 totalShares
    ) {
        HousePool storage pool = housePools[token];
        return (pool.totalDeposits, pool.totalShares);
    }

    function getPoolParticipants(address token) external view returns (address[] memory) {
        return poolParticipantList[token];
    }
}
