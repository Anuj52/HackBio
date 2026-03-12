"""Unit tests for rl_agent.py — DQN, ReplayBuffer, state/reward helpers."""
import numpy as np
import pytest

try:
    import torch
    from rl_agent import (
        DQNetwork, ReplayBuffer, BacterialDQN, BacterialAction,
        extract_state, compute_reward, STATE_DIM, ACTION_DIM,
    )
    RL_AVAILABLE = True
except ImportError:
    RL_AVAILABLE = False

pytestmark = pytest.mark.skipif(not RL_AVAILABLE, reason="torch not installed")


class TestDQNetwork:
    def test_forward_shape(self):
        net = DQNetwork()
        x = torch.randn(4, STATE_DIM)
        out = net(x)
        assert out.shape == (4, ACTION_DIM)

    def test_output_not_nan(self):
        net = DQNetwork()
        x = torch.randn(1, STATE_DIM)
        out = net(x)
        assert not torch.isnan(out).any()


class TestReplayBuffer:
    def test_push_and_len(self):
        buf = ReplayBuffer(capacity=100)
        assert len(buf) == 0
        for i in range(10):
            buf.push(np.zeros(STATE_DIM), 0, 1.0, np.zeros(STATE_DIM), False)
        assert len(buf) == 10

    def test_capacity_limit(self):
        buf = ReplayBuffer(capacity=5)
        for i in range(10):
            buf.push(np.zeros(STATE_DIM), 0, 1.0, np.zeros(STATE_DIM), False)
        assert len(buf) == 5

    def test_sample_returns_correct_size(self):
        buf = ReplayBuffer(capacity=100)
        for i in range(20):
            buf.push(np.random.randn(STATE_DIM), i % ACTION_DIM,
                     float(i), np.random.randn(STATE_DIM), i > 15)
        states, actions, rewards, next_states, dones = buf.sample(8)
        assert states.shape == (8, STATE_DIM)
        assert actions.shape == (8,)
        assert rewards.shape == (8,)
        assert next_states.shape == (8, STATE_DIM)
        assert dones.shape == (8,)


class TestBacterialDQN:
    def test_init(self, small_cfg):
        cfg = small_cfg.copy()
        cfg["rl"]["enabled"] = True
        dqn = BacterialDQN(cfg)
        assert dqn is not None
        assert dqn.enabled is True

    def test_select_action(self, small_cfg):
        cfg = small_cfg.copy()
        cfg["rl"]["enabled"] = True
        dqn = BacterialDQN(cfg)
        state = np.random.randn(STATE_DIM).astype(np.float32)
        action = dqn.select_action(state)
        assert 0 <= action < ACTION_DIM

    def test_select_actions_batch(self, small_cfg):
        cfg = small_cfg.copy()
        cfg["rl"]["enabled"] = True
        dqn = BacterialDQN(cfg)
        states = np.random.randn(5, STATE_DIM).astype(np.float32)
        actions = dqn.select_actions_batch(states)
        assert actions.shape == (5,)
        assert all(0 <= a < ACTION_DIM for a in actions)

    def test_stats(self, small_cfg):
        cfg = small_cfg.copy()
        cfg["rl"]["enabled"] = True
        dqn = BacterialDQN(cfg)
        stats = dqn.stats()
        assert "epsilon" in stats
        assert "buffer_size" in stats
        assert "device" in stats


class TestComputeReward:
    def test_alive_bonus(self):
        from agent import Bacterium, Genotype
        gt = Genotype(id=0, nutrient_efficiency=1.0, antibiotic_resistance=0.1,
                      toxin_production=0.5, public_good_production=0.5)
        b = Bacterium(genotype=gt)
        r = compute_reward(b, prev_biomass=0.5, divided=False, alive=True)
        assert r >= 0.1  # alive bonus

    def test_death_penalty(self):
        from agent import Bacterium, Genotype
        gt = Genotype(id=0, nutrient_efficiency=1.0, antibiotic_resistance=0.1,
                      toxin_production=0.5, public_good_production=0.5)
        b = Bacterium(genotype=gt)
        b.alive = False
        r = compute_reward(b, prev_biomass=0.5, divided=False, alive=False)
        assert r < -5.0  # should be significantly negative

    def test_division_bonus(self):
        from agent import Bacterium, Genotype
        gt = Genotype(id=0, nutrient_efficiency=1.0, antibiotic_resistance=0.1,
                      toxin_production=0.5, public_good_production=0.5)
        b = Bacterium(genotype=gt)
        r = compute_reward(b, prev_biomass=0.5, divided=True, alive=True)
        assert r >= 4.0  # alive bonus + division bonus + biomass delta
