# Security model

The refresh process uses GitHub's public REST API and reads repository metadata plus a bounded list of known files. It does not execute repository content. Candidate discovery is advisory; only reviewed files under `catalog/entries/` are published.

The web client treats catalog fields as untrusted text and only emits links with `http` or `https` schemes. Generated output is deterministic for a fixed scan timestamp.
