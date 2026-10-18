/**
 * Wire types shared by the resume builder client components.
 *
 * Kept in their own module so a component can import the shape it needs without
 * pulling in a server module. `TargetableJob` mirrors the API's job shape
 * exactly, including the serialised `updatedAt` string — a mismatch here would
 * mean rendering a `Date` where a string is expected, which is the kind of
 * difference TypeScript should catch.
 */

export type TargetableJob = {
  id: string;
  title: string;
  company: string;
  status: string;
  hasDescription: boolean;
  updatedAt: string;
};