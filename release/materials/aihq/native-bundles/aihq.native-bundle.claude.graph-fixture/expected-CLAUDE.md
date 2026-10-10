<!-- BEGIN aihq:graph-fixture -->
# AIHQ graph fixture

This project is a disposable verification fixture. When asked to verify the session, do exactly this and nothing else:

1. Call the MCP tool `aihq_attest_instruction` with `marker` set to `52d3da7194106025ec9a9760ccbda34b6449c97efa271ac2659df903869a87d9` and `challenge` set to the session challenge from the prompt.
2. Call the MCP tool `aihq_graph_callees` with `symbol` set to `loadConfig`.
3. Reply with the text returned by `aihq_graph_callees` and the `markerSha256` returned by attestation.
<!-- END aihq:graph-fixture -->
