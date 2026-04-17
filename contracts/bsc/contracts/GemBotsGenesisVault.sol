// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IGenesisNFA {
    function ownerOf(uint256 tokenId) external view returns (address);
}

contract GemBotsGenesisVault is Ownable, ReentrancyGuard {
    uint256 public constant GENESIS_COUNT = 100;
    uint256 public constant GENESIS_START = 1;
    uint256 public constant GENESIS_END = 100;
    uint256 public constant ACC_PRECISION = 1e12;

    address public nfaContract;
    uint256 public accPerShare;
    uint256 public totalDistributed;
    uint256 public totalReceived;
    bool public paused;

    mapping(uint256 => uint256) public rewardDebt;
    mapping(address => uint256) public pendingPayment;

    event FundsReceived(uint256 amount, uint256 newAccPerShare);
    event Claimed(uint256 indexed tokenId, address indexed owner, uint256 amount);
    event PendingPaymentStored(address indexed owner, uint256 amount);
    event PendingPaymentClaimed(address indexed owner, uint256 amount);
    event EmergencyPause(bool paused);
    event NfaContractUpdated(address indexed nfaContract);

    constructor(address _nfaContract) Ownable(msg.sender) {
        require(_nfaContract != address(0), "Invalid NFA contract");
        nfaContract = _nfaContract;
    }

    receive() external payable {
        _accrue(msg.value);
    }

    function distribute() external payable onlyOwner {
        _accrue(msg.value);
    }

    function _accrue(uint256 amount) internal {
        require(amount > 0, "No funds received");
        totalReceived += amount;
        accPerShare += (amount * ACC_PRECISION) / GENESIS_COUNT;
        emit FundsReceived(amount, accPerShare);
    }

    function pendingReward(uint256 tokenId) public view returns (uint256) {
        _requireGenesisToken(tokenId);
        if (accPerShare <= rewardDebt[tokenId]) {
            return 0;
        }
        return (accPerShare - rewardDebt[tokenId]) / ACC_PRECISION;
    }

    function claim(uint256 tokenId) external nonReentrant {
        require(!paused, "Claims paused");
        _requireGenesisToken(tokenId);

        address owner = IGenesisNFA(nfaContract).ownerOf(tokenId);
        require(msg.sender == owner, "Not owner");

        uint256 reward = pendingReward(tokenId);
        require(reward > 0, "Nothing to claim");

        rewardDebt[tokenId] = accPerShare;
        totalDistributed += reward;
        _payOrStore(owner, reward);

        emit Claimed(tokenId, owner, reward);
    }

    function claimPendingPayment() external nonReentrant {
        uint256 amount = pendingPayment[msg.sender];
        require(amount > 0, "No pending payment");

        pendingPayment[msg.sender] = 0;
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "Pending payment transfer failed");

        emit PendingPaymentClaimed(msg.sender, amount);
    }

    function emergencyPause() external onlyOwner {
        paused = true;
        emit EmergencyPause(true);
    }

    function resume() external onlyOwner {
        paused = false;
        emit EmergencyPause(false);
    }

    function setNfaContract(address _nfaContract) external onlyOwner {
        require(_nfaContract != address(0), "Invalid NFA contract");
        nfaContract = _nfaContract;
        emit NfaContractUpdated(_nfaContract);
    }

    function _payOrStore(address owner, uint256 amount) internal {
        (bool sent, ) = payable(owner).call{value: amount}("");
        if (!sent) {
            pendingPayment[owner] += amount;
            emit PendingPaymentStored(owner, amount);
        }
    }

    function _requireGenesisToken(uint256 tokenId) internal pure {
        require(tokenId >= GENESIS_START && tokenId <= GENESIS_END, "Not genesis");
    }
}
