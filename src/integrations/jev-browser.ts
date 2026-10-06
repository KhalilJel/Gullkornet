export type BrowserAction = {
  type: "click" | "type" | "scroll" | "navigate" | "wait";
  target?: string;
  value?: string;
};

export type BrowserObservation = {
  url: string;
  action: BrowserAction;
  result: "success" | "blocked" | "failed";
  observation: string;
  screenshotUrl?: string;
  collectedAt: string;
};

export type JEVBrowserClient = {
  execute(actions: BrowserAction[]): Promise<BrowserObservation[]>;
};

export function createJEVBrowserClient(): JEVBrowserClient {
  throw new Error(
    "JEV browser runtime is not configured. Connect the JEV runtime before enabling live browser actions."
  );
}
