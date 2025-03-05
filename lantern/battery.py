#!/usr/bin/env python3

"""
battery.py

This module models a battery for the LEC simulation. Provides API for charging and discharging.
Considers c_rate, conversion loss, and other factors to make it more realistic.
"""

from functools import cached_property
from .constants import (
    CHARGE_THRESHOLD,
    CONVERSION_LOSS,
    RETENTION_RATE,
    C_RATE,
    DISCHARGE_THRESHOLD,
)


class Battery:
    def __init__(self, capacity: float, timestep_duration: float):
        assert capacity >= 0, "Battery Capacity not allowed to be negative."

        self._capacity: float = capacity
        self._current_cap: float = DISCHARGE_THRESHOLD * capacity
        self._timestep_duration: float = timestep_duration

    def charge(self, amount: float) -> float:
        """
        Tries to charge the battery with the given amount. The method considers
        conversion loss and adjusts the battery capacity accordingly.

        Args:
            amount (float): The amount of power to charge the battery with, in kWh.
                            This value is limited to the maximum charge amount that the battery can handle
                            (due to c_rate limit, capacity limit, and conversion loss).

        Returns:
            float: The actual amount of power used for charging before considering conversion loss.
                This value will be less than or equal to the input `amount`, but greater than the capacity
                the battery gained.
        """
        amount = min(amount, self._maxChargeAmount())
        charged_amount: float = amount * 1 - CONVERSION_LOSS
        self._current_cap += charged_amount
        self._timestep()
        return amount

    def discharge(self, amount: float) -> float:
        """
        Tries to discharge the given amount from the battery. The method considers
        conversion loss and adjusts the battery capacity accordingly.

        Args:
            amount (float): The amount of power to discharge from the battery, in kWh.
                            This value is limited to the maximum amount that can be discharged
                            from the battery, given its current state (current capacity, minimum capacity,
                            discharge rate, and conversion loss).

        Returns:
            float: The amount of power available for the client after discharging (after considering conversion loss).
                This value will be less than or equal to the input `amount`, and to the lost capacity of the battery.
        """
        amount = min(amount, self._maxDischargeAmount())
        discharged_amount: float = amount * 1 / (1 - CONVERSION_LOSS)
        self._current_cap -= discharged_amount
        self._timestep()
        return amount

    def reset(self) -> None:
        """
        Resets the battery to its minimum allowed capacity.
        """
        self._current_cap = DISCHARGE_THRESHOLD * self._capacity

    def _maxChargeAmount(self) -> float:
        # some energy is lost when converting
        # don't charge faster than C_RATE
        # don't charge beyond charging threshold
        maxChargeAmount: float = max(0.0, self._maxAllowedCharge - self._current_cap)
        cRateLimit: float = self._getCRateLimit()
        maxChargeAmount = min(maxChargeAmount, cRateLimit)
        return maxChargeAmount * (1 / (1 - CONVERSION_LOSS))

    def _maxDischargeAmount(self) -> float:
        # some energy is lost when converting
        # only discharge to threshold
        # discharge at rate no faster than given by c_rate
        maxDischargeAmount: float = max(0.0, self._current_cap - self._minAllowedCharge)
        cRateLimit: float = C_RATE * self._timestep_duration * self._capacity
        maxDischargeAmount = min(maxDischargeAmount, cRateLimit)
        return maxDischargeAmount * (1 - CONVERSION_LOSS)

    def _getCRateLimit(self) -> float:
        return C_RATE * self._timestep_duration * self._capacity

    @cached_property
    def _minAllowedCharge(self) -> float:
        return DISCHARGE_THRESHOLD * self._capacity

    @cached_property
    def _maxAllowedCharge(self) -> float:
        return CHARGE_THRESHOLD * self._capacity

    def _timestep(self) -> None:
        """
        Executes bookkeeping operations that signify a timestep was executed.
        """
        self._current_cap = min(self._capacity, max(0, self._current_cap))
        self._current_cap *= 1 - ((1 - RETENTION_RATE) * self._timestep_duration)
