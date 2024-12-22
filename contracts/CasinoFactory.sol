// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./security/Pausable.sol";
import "./access/Ownable.sol";
import "./TokenPool.sol";
import "./errors/CasinoErrors.sol";

/**
 * @title CasinoFactory
 * @dev Factory contract for deploying and managing token pools
 */
contract CasinoFactory is Pausable, Ownable {
    // State Variables
    address public platformWallet;
    address public router;
    uint256 public poolCreationFee; // Optional fee for creating pools

    /**
     * @dev Set the router address
     */
    function setRouter(address _router) external onlyOwner {
        if (_router == address(0)) revert InvalidWalletAddress();
        router = _router;
    }
    
    // Operators
    mapping(address => bool) public operators;
    mapping(address => string) public operatorNames;

    // Pools
    mapping(address => address) public tokenToPools;
    mapping(address => bool) public isPoolDeployed;
    address[] public deployedTokens; // Track each token that has a pool

    // Events
    event TokenWhitelisted(address indexed token, bool status);
    event PoolCreated(address indexed token, address indexed pool);
    event OperatorUpdated(address indexed operator, bool status, string name);
    event PlatformWalletUpdated(address indexed newWallet);
    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event GameFeeUpdated(uint256 oldFee, uint256 newFee);

    constructor() Ownable(msg.sender) {}

    function initialize(address _platformWallet) external {
        if (_platformWallet == address(0)) revert InvalidWalletAddress();
        if (platformWallet != address(0)) {
            revert("Already initialized");
        }
        platformWallet = _platformWallet;
    }

    /**
     * @dev Add or remove an operator
     */
    function setOperator(address operator, bool status, string memory name) external onlyOwner {
        if (operator == address(0)) revert InvalidWalletAddress();
        operators[operator] = status;
        if (status) {
            operatorNames[operator] = name;
        } else {
            delete operatorNames[operator];
        }
        emit OperatorUpdated(operator, status, name);
    }

    /**
     * @dev Check if an address is an authorized operator
     */
    function isOperator(address operatorAddr) external view returns (bool) {
        return operators[operatorAddr];
    }

    /**
     * @dev Get operator name for Firebase identification
     */
    function getOperatorName(address operatorAddr) external view returns (string memory) {
        require(operators[operatorAddr], "Not an operator");
        return operatorNames[operatorAddr];
    }

    /**
     * @dev Update platform wallet
     */
    function updatePlatformWallet(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert InvalidWalletAddress();
        platformWallet = newWallet;
        emit PlatformWalletUpdated(newWallet);
    }

    /**
     * @dev Set pool creation fee
     */
    function setPoolCreationFee(uint256 newFee) external onlyOwner {
        poolCreationFee = newFee;
    }

    /**
     * @dev Create a new pool for a token
     * Anyone can create a pool by paying the creation fee
     * Factory maintains ownership and control
     */
    function createPool(address token) external payable {
        if (token == address(0)) revert InvalidWalletAddress();
        if (isPoolDeployed[token]) revert PoolAlreadyExists();
        
        // Check creation fee if set
        if (poolCreationFee > 0) {
            if (msg.value < poolCreationFee) revert InvalidAmount();
            // Forward fee to platform wallet
            (bool sent, ) = platformWallet.call{value: msg.value}("");
            if (!sent) revert("Failed to send fee");
        }

        // Deploy new pool (factory remains owner)
        TokenPool pool = new TokenPool(token, address(this), platformWallet);
        
        // Record
        tokenToPools[token] = address(pool);
        isPoolDeployed[token] = true;
        deployedTokens.push(token);

        emit PoolCreated(token, address(pool));
    }

    /**
     * @dev Pause all pools
     */
    function pause() external onlyOwner {
        _pause();
        // Pause all pools
        (, address[] memory pools) = getDeployedPools();
        for (uint i = 0; i < pools.length; i++) {
            if (pools[i] != address(0)) {
                TokenPool(pools[i]).pause();
            }
        }
    }

    /**
     * @dev Unpause all pools
     */
    function unpause() external onlyOwner {
        _unpause();
        // Unpause all pools
        (, address[] memory pools) = getDeployedPools();
        for (uint i = 0; i < pools.length; i++) {
            if (pools[i] != address(0)) {
                TokenPool(pools[i]).unpause();
            }
        }
    }

    /**
     * @dev Get pool address for a token
     */
    function getPool(address token) external view returns (bool exists, address pool) {
        pool = tokenToPools[token];
        exists = (pool != address(0));
    }

    /**
     * @dev Get all deployed pools
     */
    function getDeployedPools() public view returns (address[] memory tokens, address[] memory pools) {
        uint256 length = deployedTokens.length;
        tokens = new address[](length);
        pools = new address[](length);

        for (uint i = 0; i < length; i++) {
            address t = deployedTokens[i];
            tokens[i] = t;
            pools[i] = tokenToPools[t];
        }
    }

    /**
     * @dev Emergency withdraw from a specific pool
     */
    function emergencyWithdrawFromPool(address token) external onlyOwner whenPaused {
        address poolAddress = tokenToPools[token];
        if (poolAddress == address(0)) revert PoolDoesNotExist();
        
        TokenPool(poolAddress).emergencyWithdraw();
    }
}
