# Gate Runtime dispatch on rewind checkpoints

For rewindable project Runs, Carrent waits for the `before` checkpoint before starting the Runtime and waits for the `after` checkpoint before dispatching the Thread's next Run. Snapshot failure or the five-second timeout creates a Rewind Barrier and releases execution; the Composer remains editable and submitted messages may queue throughout checkpointing, so recovery correctness delays Runtime dispatch without blocking user input.
