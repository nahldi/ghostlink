const agentColorMapRef: { current: Record<string, string> } = { current: {} };

export function setMentionColorMap(agentColorMap: Record<string, string>) {
  agentColorMapRef.current = agentColorMap;
}

export function getMentionColorMap() {
  return agentColorMapRef.current;
}
