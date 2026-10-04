# Pattern: LLM backend-proxy

**Status:** draft — generalized from a project pattern; review before relying on it.

Proxy every LLM-provider call through the backend; never ship an API key to the client. The route holds the key in server-side env, validates the request, and returns only the model output.
