export interface VercelRequest {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
}

export interface VercelResponse {
  status(code: number): VercelResponse;
  json(value: unknown): VercelResponse;
  send(value: unknown): VercelResponse;
  end(): VercelResponse;
  setHeader(name: string, value: string): VercelResponse;
}