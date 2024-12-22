// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";

interface ICustomToken is IERC20 {
    function forceApprove(address spender, uint256 amount) external returns (bool);
}
