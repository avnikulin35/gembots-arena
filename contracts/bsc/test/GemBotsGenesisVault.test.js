const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('GemBotsGenesisVault', function () {
  async function deployFixture() {
    const [owner, holderA, holderB, outsider] = await ethers.getSigners();
    const MockGenesisNFA = await ethers.getContractFactory('MockGenesisNFA');
    const nfa = await MockGenesisNFA.deploy();
    await nfa.waitForDeployment();

    await nfa.mint(holderA.address, 1);
    await nfa.mint(holderB.address, 2);

    const GemBotsGenesisVault = await ethers.getContractFactory('GemBotsGenesisVault');
    const vault = await GemBotsGenesisVault.deploy(await nfa.getAddress());
    await vault.waitForDeployment();

    return { owner, holderA, holderB, outsider, nfa, vault };
  }

  it('distributes correctly across multiple deposits and multiple claims', async function () {
    const { owner, holderA, vault } = await deployFixture();

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });
    expect(await vault.pendingReward(1)).to.equal(ethers.parseEther('0.01'));

    await expect(() => vault.connect(holderA).claim(1)).to.changeEtherBalances(
      [vault, holderA],
      [-ethers.parseEther('0.01'), ethers.parseEther('0.01')]
    );

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('2.0') });
    expect(await vault.pendingReward(1)).to.equal(ethers.parseEther('0.02'));

    await expect(() => vault.connect(holderA).claim(1)).to.changeEtherBalances(
      [vault, holderA],
      [-ethers.parseEther('0.02'), ethers.parseEther('0.02')]
    );
  });

  it('late claimer receives the same total reward as early claimer under equal deposits', async function () {
    const { owner, holderA, holderB, vault } = await deployFixture();

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });
    await expect(() => vault.connect(holderA).claim(1)).to.changeEtherBalances(
      [vault, holderA],
      [-ethers.parseEther('0.01'), ethers.parseEther('0.01')]
    );

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });

    await expect(() => vault.connect(holderA).claim(1)).to.changeEtherBalances(
      [vault, holderA],
      [-ethers.parseEther('0.01'), ethers.parseEther('0.01')]
    );

    await expect(() => vault.connect(holderB).claim(2)).to.changeEtherBalances(
      [vault, holderB],
      [-ethers.parseEther('0.02'), ethers.parseEther('0.02')]
    );
  });

  it('reverts when a non-owner tries to claim for another holder token', async function () {
    const { owner, holderB, vault } = await deployFixture();

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });
    await expect(vault.connect(holderB).claim(1)).to.be.revertedWith('Not owner');
  });

  it('reverts for token ids outside the genesis range', async function () {
    const { vault } = await deployFixture();

    await expect(vault.pendingReward(0)).to.be.revertedWith('Not genesis');
    await expect(vault.pendingReward(101)).to.be.revertedWith('Not genesis');
  });

  it('stores pending payment when receiver rejects ETH and allows later withdrawal', async function () {
    const { owner, nfa, vault } = await deployFixture();
    const NonReceivingMock = await ethers.getContractFactory('NonReceivingMock');
    const receiver = await NonReceivingMock.deploy();
    await receiver.waitForDeployment();

    await nfa.mint(await receiver.getAddress(), 3);
    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });

    await expect(receiver.claim(await vault.getAddress(), 3)).to.not.be.reverted;
    expect(await vault.pendingPayment(await receiver.getAddress())).to.equal(ethers.parseEther('0.01'));

    await receiver.setRejectPayments(false);

    await expect(async () => receiver.claimPending(await vault.getAddress())).to.changeEtherBalances(
      [vault, receiver],
      [-ethers.parseEther('0.01'), ethers.parseEther('0.01')]
    );

    expect(await vault.pendingPayment(await receiver.getAddress())).to.equal(0n);
  });

  it('reverts on a double claim when no new deposits arrived', async function () {
    const { owner, holderA, vault } = await deployFixture();

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });
    await vault.connect(holderA).claim(1);

    await expect(vault.connect(holderA).claim(1)).to.be.revertedWith('Nothing to claim');
  });

  it('supports pause and resume lifecycle for claims', async function () {
    const { owner, holderA, vault } = await deployFixture();

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });
    await vault.connect(owner).emergencyPause();

    await expect(vault.connect(holderA).claim(1)).to.be.revertedWith('Claims paused');

    await vault.connect(owner).resume();

    await expect(() => vault.connect(holderA).claim(1)).to.changeEtherBalances(
      [vault, holderA],
      [-ethers.parseEther('0.01'), ethers.parseEther('0.01')]
    );
  });
});
