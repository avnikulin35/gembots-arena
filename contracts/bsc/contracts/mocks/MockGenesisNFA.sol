// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockGenesisNFA is ERC721 {
    constructor() ERC721("MockGenesisNFA", "MGN") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}
