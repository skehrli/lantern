from lantern.main import run_simulation
from lantern.main import Season
import pytest
from hypothesis import given, strategies as st, settings, HealthCheck


# New hypothesis-based fuzzing test
@settings(
    max_examples=10,  # Number of test cases to generate
    deadline=None,  # Disable test deadline to allow for longer simulations
    # Suppress warnings about slow tests
    suppress_health_check=[HealthCheck.too_slow]
)
@given(
    community_size=st.integers(min_value=5, max_value=100),
    season=st.sampled_from([s.value for s in Season]),
    pv=st.integers(min_value=0, max_value=100),
    sd=st.integers(min_value=0, max_value=100),
    battery=st.booleans()
)
def test_simulation_with_hypothesis(community_size, season, pv, sd, battery):
    """
    Fuzz test the simulation with Hypothesis.
    This will generate a wide variety of inputs and look for edge cases.
    """
    run_simulation(community_size, season, pv, sd, battery)


# Optional: Add more targeted property-based tests
@settings(max_examples=5,
          deadline=None,  # Disable test deadline to allow for longer simulations
          )
@given(
    community_size=st.integers(
        min_value=5, max_value=10),  # Larger communities
    season=st.sampled_from([s.value for s in Season]),
    pv=st.integers(min_value=75, max_value=100),  # High PV capacity
    sd=st.integers(min_value=0, max_value=100),
    battery=st.booleans()
)
def test_simulation_high_pv_low_storage(community_size, season, pv, sd, battery):
    """Test the simulation with high PV capacity and low storage."""
    run_simulation(community_size, season, pv, sd, battery)
