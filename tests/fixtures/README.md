# FIT fixtures

`garmin-fenix-5-run.fit` is the small Garmin Fenix 5 running activity from
`polyvertex/fitdecode`'s MIT-licensed test corpus. It is 5,597 bytes with SHA-256
`db12d0986f3b707802480d6a79bc6bf5d3061010ffe98a1b99115dd44e75f5be`.

Both `fitdecode==0.11.0` and `garmin-fit-sdk==21.214.0` were exercised against
this fixture. Both produced source identity fields `garmin`, `fenix5`,
`3945849289`, and `2017-06-11T14:34:09Z`, plus session values `running`,
`2017-06-11T14:34:09Z`, `56.887` elapsed seconds, and `157.56` metres. Tempo
selected `fitdecode` because its smaller streaming API directly
supports strict CRC and malformed-data handling and chained FIT files. The
runtime dependency is pinned in `pyproject.toml`; Garmin's SDK was comparison
only.

`garmin-fenix-5-bike.fit` is a 4,664-byte cycling fixture from the same corpus,
with SHA-256 `9206d34ba9c6283eb24337410c66d9d2f9b134d709ba2cf97bb5e20ae28f6314`. It verifies that a valid but
unsupported FIT activity is rejected without persistent side effects.
