// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./token/ERC20/ERC20.sol";
import "./access/Ownable.sol";

contract TestToken is ERC20, Ownable {
    constructor() ERC20("Test Token", "TEST") Ownable(msg.sender) {
        // Mint 1,000,000 tokens to deployer
        _mint(msg.sender, 1000000 * 10**decimals());
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
