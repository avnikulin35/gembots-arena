// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title GemBotsGenesisVault
 * @notice Revenue share vault for Genesis NFA holders (tokenId 1-100).
 *         Receives platform fees and distributes equally among Genesis holders.
 */
contract GemBotsGenesisVault is Ownable, ReentrancyGuard {
    uint256 public constant GENESIS_COUNT = 100;
    uint256 public constant GENESIS_START = 1;
    uint256 public constant GENESIS_END = 100;

    address public nfaContract;
    uint256 public totalDistributed;
    uint256 public totalReceived;

    mapping(uint256 => uint256) public claimed; // tokenId => amount claimed

    event FundsReceived(uint256 amount);
    event Claimed(uint256 indexed tokenId, address indexed owner, uint256 amount);

    constructor(address _nfaContract) Ownable(msg.sender) {
        nfaContract = _nfaContract;
    }

    receive() external payable {
        totalReceived += msg.value;
        emit FundsReceived(msg.value);
    }

    function pendingReward(uint256 tokenId) public view returns (uint256) {
        require(tokenId >= GENESIS_START && tokenId <= GENESIS_END, "Not genesis");
        uint256 perToken = totalReceived / GENESIS_COUNT;
        return perToken - claimed[tokenId];
    }

    function claim(uint256 tokenId) external nonReentrant {
        require(tokenId >= GENESIS_START && tokenId <= GENESIS_END, "Not genesis");
        // Check ownership via NFA contract
        (bool ok, bytes memory data) = nfaContract.staticcall(
            abi.encodeWithSignature("ownerOf(uint256)", tokenId)
        );
        require(ok, "ownerOf failed");
        address owner = abi.decode(data, (address));
        require(msg.sender == owner, "Not owner");

        uint256 reward = pendingReward(tokenId);
        require(reward > 0, "Nothing to claim");

        claimed[tokenId] += reward;
        totalDistributed += reward;

        (bool sent, ) = payable(owner).call{value: reward}("");
        require(sent, "Transfer failed");

        emit Claimed(tokenId, owner, reward);
    }

    function setNfaContract(address _nfa) external onlyOwner {
        nfaContract = _nfa;
    }
}
