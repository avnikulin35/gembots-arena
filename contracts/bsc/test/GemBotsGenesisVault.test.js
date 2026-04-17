const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('GemBotsGenesisVault', function () {
  async function deployFixture() {
    const [owner, holderA, holderB] = await ethers.getSigners();
    const MockGenesisNFA = await ethers.getContractFactory('MockGenesisNFA');
    const nfa = await MockGenesisNFA.deploy();
    await nfa.waitForDeployment();

    await nfa.mint(holderA.address, 1);
    await nfa.mint(holderB.address, 2);

    const GemBotsGenesisVault = await ethers.getContractFactory('GemBotsGenesisVault');
    const vault = await GemBotsGenesisVault.deploy(await nfa.getAddress());
    await vault.waitForDeployment();

    return { owner, holderA, holderB, nfa, vault };
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

  it('blocks claim when emergency pause is enabled', async function () {
    const { owner, holderA, vault } = await deployFixture();

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });
    await vault.connect(owner).emergencyPause();

    await expect(vault.connect(holderA).claim(1)).to.be.revertedWith('Claims paused');
  });
});
