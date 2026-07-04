export function buildProjectPath(projectId: string) {
  return `/project/${projectId}`;
}

export function buildThreadPath(projectId: string, threadId: string) {
  return `/thread/${projectId}/${threadId}`;
}

export function buildChatPath(threadId: string) {
  return `/chat/${threadId}`;
}

export function getProjectIdFromPathname(pathname: string) {
  const [, route, firstParam] = pathname.split("/");

  if (route === "project" || route === "thread") {
    return firstParam || null;
  }

  return null;
}
