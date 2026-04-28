"""Tests for smart routing and query endpoint extensions."""

import pytest
from mac.services.llm_service import _smart_route


def test_smart_route_code_keywords():
    messages = [{"role": "user", "content": "Write a Python function to sort a list and debug the algorithm"}]
    result = _smart_route(messages)
    assert result == "qwen2.5-coder:7b"


def test_smart_route_math_keywords():
    messages = [{"role": "user", "content": "Solve this integral of x squared and calculate the derivative"}]
    result = _smart_route(messages)
    assert result == "deepseek-r1:14b"


def test_smart_route_general():
    messages = [{"role": "user", "content": "Hello, how are you today?"}]
    result = _smart_route(messages)
    assert result == "qwen2.5:7b"


def test_smart_route_empty():
    result = _smart_route([])
    assert result is not None


def test_smart_route_none():
    result = _smart_route(None)
    assert result is not None
