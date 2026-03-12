#!/usr/bin/env python3
"""
main.py — CLI entry point for the Bacterial Colony ABM Simulation.

Usage:
    python main.py                          # Run with default config.yaml
    python main.py --config my_config.yaml  # Custom config
    python main.py --epochs 300             # Override epochs
    python main.py --dashboard              # Launch live dashboard instead
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time

logger = logging.getLogger(__name__)

import yaml


def load_config(path: str = "config.yaml") -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def epoch_callback(epoch: int, sim) -> None:
    """Print progress every 10 epochs."""
    if epoch % 10 == 0 or epoch == 1:
        alive = len(sim.agents)
        res = sim.env.mean_resource()
        ab = sim.env.mean_antibiotic()
        logger.info("  [epoch %4d]  pop=%5d  resource=%.3f  antibiotic=%.4f",
                    epoch, alive, res, ab)


def run_simulation(cfg: dict) -> None:
    """Run the full headless simulation, export CSV and charts."""
    from simulate import Simulation
    from visualize import generate_all_plots

    # Create output directories
    out_dir = cfg["simulation"].get("output_dir", "output")
    charts_dir = cfg["simulation"].get("charts_dir", "charts")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(charts_dir, exist_ok=True)

    total_epochs = cfg["simulation"]["epochs"]
    logger.info("=" * 60)
    logger.info("  Bacterial Colony ABM — Headless Simulation")
    logger.info("  Epochs: %d", total_epochs)
    logger.info("  Initial pop: %d", cfg['bacterium']['initial_count'])
    logger.info("  Carrying capacity: %d", cfg['population']['carrying_capacity'])
    logger.info("  Grid: %dx%d", cfg['grid']['width'], cfg['grid']['height'])
    logger.info("  Seed: %s", cfg['simulation'].get('seed', 'random'))
    logger.info("=" * 60)

    t0 = time.time()
    sim = Simulation(cfg)
    metrics = sim.run(callback=epoch_callback)
    elapsed = time.time() - t0

    alive = len(sim.agents)
    logger.info("-" * 60)
    logger.info("  Simulation complete in %.1fs", elapsed)
    logger.info("  Final population: %d", alive)
    logger.info("  Total epochs run: %d", sim.epoch)

    csv_path = sim.export_csv()
    logger.info("  CSV saved: %s", csv_path)

    logger.info("  Generating charts...")
    chart_files = generate_all_plots(sim)
    logger.info("  %d charts saved to %s/", len(chart_files), charts_dir)
    for f in chart_files:
        logger.info("    - %s", os.path.basename(f))
    logger.info("=" * 60)
    logger.info("  Done! Check output/ and charts/ directories.")


def run_dashboard(cfg: dict) -> None:
    """Launch the Flask+SocketIO live dashboard."""
    logger.info("Launching live dashboard...")
    os.makedirs("output", exist_ok=True)
    os.makedirs("charts", exist_ok=True)
    # Import and run the dashboard
    import dashboard
    dashboard.socketio.run(
        dashboard.app, host="0.0.0.0", port=5000,
        debug=False, allow_unsafe_werkzeug=True
    )


def main():
    parser = argparse.ArgumentParser(
        description="Bacterial Colony Agent-Based Model Simulation"
    )
    parser.add_argument(
        "--config", "-c", default="config.yaml",
        help="Path to YAML configuration file (default: config.yaml)"
    )
    parser.add_argument(
        "--epochs", "-e", type=int, default=None,
        help="Override number of simulation epochs"
    )
    parser.add_argument(
        "--seed", "-s", type=int, default=None,
        help="Override random seed (omit for random)"
    )
    parser.add_argument(
        "--dashboard", "-d", action="store_true",
        help="Launch live web dashboard instead of headless run"
    )
    parser.add_argument(
        "--initial-count", "-n", type=int, default=None,
        help="Override initial population count"
    )
    parser.add_argument(
        "--carrying-capacity", "-k", type=int, default=None,
        help="Override carrying capacity"
    )

    args = parser.parse_args()

    # Load config
    if not os.path.exists(args.config):
        logger.error("Config file '%s' not found.", args.config)
        sys.exit(1)

    cfg = load_config(args.config)

    # Apply CLI overrides
    if args.epochs is not None:
        cfg["simulation"]["epochs"] = args.epochs
    if args.seed is not None:
        cfg["simulation"]["seed"] = args.seed
    if args.initial_count is not None:
        cfg["bacterium"]["initial_count"] = args.initial_count
    if args.carrying_capacity is not None:
        cfg["population"]["carrying_capacity"] = args.carrying_capacity

    if args.dashboard:
        run_dashboard(cfg)
    else:
        run_simulation(cfg)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
    main()

