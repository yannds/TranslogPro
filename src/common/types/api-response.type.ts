/** Standard paginated list response */
export interface PaginatedResponse<T> {
  data:  T[];
  meta: {
    total:   number;
    page:    number;
    limit:   number;
    pages:   number;
  };
}

/** RFC 7807 Problem Details */
export interface ProblemDetails {
  type:     string;
  title:    string;
  status:   number;
  detail?:  string;
  instance?: string;
  /** Extra fields */
  [key: string]: unknown;
}
