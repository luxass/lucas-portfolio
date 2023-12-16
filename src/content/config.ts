import { defineCollection } from "astro:content";
import { z } from "zod";

const posts = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string().max(40),
    description: z.string().max(120),
    date: z.string().transform((str) => new Date(str)),
    published: z.boolean().optional().default(true),
    icon: z.union([
      z.string().emoji(),
      z.string().refine((str) => str.includes(":")),
    ]).optional(),
    handle: z.string().optional(),
  }),
});

const projects = defineCollection({
  type: "content",
  schema: z.object({
    handle: z.string().optional(),
    githubUrl: z.string(),
    // github repo names is a maximum of 100 characters.
    name: z.string().max(100),
    owner: z.string(),
    description: z.string().max(120).nullable(),
    npm: z.string().optional(),
    handles: z.array(z.string()).optional(),
  }),
});

export const collections = { posts, projects };
