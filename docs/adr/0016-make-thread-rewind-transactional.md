# Make Thread Rewind transactional

Thread Rewind uses a durable transaction journal and a temporary pre-operation project tree so project files, Thread history, draft state, and Runtime Session mappings change as one recoverable operation. A successful commit removes the temporary recovery data; any failure or app restart before commit rolls both files and Thread data back to their pre-rewind state. If automatic rollback fails, Carrent blocks further Runs for that Thread and reports the affected files instead of continuing from a mixed state.
