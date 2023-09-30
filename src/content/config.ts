import { defineCollection } from "astro:content";
import { z } from "zod";

const posts = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string().max(50),
    description: z.string().max(120),
    date: z.string().transform(str => new Date(str)),
    published: z.boolean().optional().default(true),
    icon: z.string().optional().default("📝"),
    handle: z.string().optional(),
  }),
});

const projects = defineCollection({
  type: "content",
  schema: z.object({
    handle: z.string().optional(),
  }),
});

export const collections = { posts, projects };
