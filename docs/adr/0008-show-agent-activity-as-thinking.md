# Show agent activity as Thinking

Carrent shows the ordered agent activity trail under the user-facing label `Thinking`, including reasoning steps and tool activity in the order they occurred. The run starts with this section expanded so users can see what the coding agent is doing, then collapses it when the final answer begins; the settled label becomes `Completed`, `Failed`, or `Cancelled` with elapsed time. This keeps reasoning and tool use in one simple activity surface instead of splitting them into separate panels that lose the timing relationship.

Agent Core events are presented as one chronological Run timeline. Ordinary agent messages use normal Markdown styling between activity rows, each Thinking item is collapsed by default, and Tool Activity remains visible as compact rows. This preserves event order without classifying ordinary agent messages as activity.
