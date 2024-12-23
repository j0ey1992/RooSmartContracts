// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICasinoFactory {
    function operators(address) external view returns (bool);
    function owner() external view returns (address);
    function router() external view returns (address);
}
