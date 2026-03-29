from routes import agents


def test_validate_spawn_args_allows_known_long_flags() -> None:
    assert agents._validate_spawn_args("claude", ["--dangerously-skip-permissions"], []) == [
        "--dangerously-skip-permissions"
    ]


def test_validate_spawn_args_allows_known_short_hyphen_flag() -> None:
    assert agents._validate_spawn_args("gemini", ["-y"], []) == ["-y"]
