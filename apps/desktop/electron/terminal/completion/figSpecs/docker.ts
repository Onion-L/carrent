// Static subset imported from withfig/autocomplete's Docker specification.
// Dynamic generators are intentionally excluded by Carrent's bounded adapter.
export const dockerFigSpec = {
  name: "docker",
  description: "A self-sufficient runtime for containers",
  subcommands: [
    {
      name: "build",
      description: "Build an image from a Dockerfile",
      options: [
        { name: "--file", description: "Name of the Dockerfile" },
        { name: "--no-cache", description: "Do not use cache when building the image" },
        { name: "--pull", description: "Always attempt to pull a newer version of the image" },
        { name: "--tag", description: "Name and optionally a tag in the name:tag format" },
      ],
    },
    { name: "compose", description: "Define and run multi-container applications" },
    { name: "exec", description: "Run a command in a running container" },
    { name: "images", description: "List images" },
    { name: "logs", description: "Fetch the logs of a container" },
    { name: "ps", description: "List containers" },
    { name: "pull", description: "Pull an image or a repository" },
    { name: "push", description: "Push an image or a repository" },
    { name: "run", description: "Run a command in a new container" },
    { name: "stop", description: "Stop one or more running containers" },
  ],
} as const;
