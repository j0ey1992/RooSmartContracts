// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "./token/ERC20/IERC20.sol";
import {SafeERC20} from "./token/ERC20/utils/SafeERC20.sol";
import "./CasinoFactory.sol";
import "./TokenPool.sol";

/**
 * @title CasinoRouter
 * @dev Provides a simplified interface for interacting with multiple token pools
 */
contract CasinoRouter {
    using SafeERC20 for IERC20;

    CasinoFactory public immutable factory;

    constructor(address _factory) {
        if (_factory == address(0)) revert InvalidWalletAddress();
        factory = CasinoFactory(_factory);
    }

    /**
     * @dev Deposit tokens to a specific pool
     * @param token Token address
     * @param amount Amount to deposit
     */
    function depositToPool(address token, uint256 amount) external {
        (bool exists, address poolAddress) = factory.getPool(token);
        if (!exists || poolAddress == address(0)) revert PoolDoesNotExist();
        if (amount == 0) revert InvalidWalletAddress();

        IERC20 tokenContract = IERC20(token);
        // Transfer to this router, then approve pool
        tokenContract.safeTransferFrom(msg.sender, address(this), amount);
        tokenContract.forceApprove(poolAddress, amount);

        // Deposit to the pool
        TokenPool(poolAddress).deposit(amount);
    }

    /**
     * @dev Withdraw tokens from a specific pool with an operator signature
     */
    function withdrawFromPool(
        address token,
        uint256 amount
    ) external {
        (bool exists, address poolAddress) = factory.getPool(token);
        if (!exists || poolAddress == address(0)) revert PoolDoesNotExist();

        TokenPool(poolAddress).withdraw(amount);
    }

    /**
     * @dev Check if a user has any balance across multiple pools
     */
    function hasActivePools(address[] calldata tokens) external view returns (bool hasBalance) {
        for (uint i = 0; i < tokens.length; i++) {
            (bool exists, address poolAddress) = factory.getPool(tokens[i]);
            if (exists && poolAddress != address(0)) {
                uint256 bal = TokenPool(poolAddress).getPoolBalance();
                if (bal > 0) {
                    hasBalance = true;
                    break;
                }
            }
        }
    }

    /**
     * @dev Get pool balances for multiple tokens
     */
    function getPoolBalances(address[] calldata tokens) external view returns (uint256[] memory balances) {
        balances = new uint256[](tokens.length);
        for (uint i = 0; i < tokens.length; i++) {
            (bool exists, address poolAddress) = factory.getPool(tokens[i]);
            if (exists && poolAddress != address(0)) {
                balances[i] = TokenPool(poolAddress).getPoolBalance();
            }
        }
    }
}
