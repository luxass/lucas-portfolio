import process from "node:process";
import { mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { graphql } from "@octokit/graphql";
import z from "zod";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";
import { type Plugin, unified } from "unified";
import { remark } from "remark";
import rehypeParse from "rehype-parse";
import { visit } from "unist-util-visit";
import remarkComment from "remark-comment";

const BANNER
  = "// THIS FILE IS AUTOGENERATED BY ./scripts/update-site.ts. DO NOT EDIT THIS FILE DIRECTLY.";

interface Profile {
  viewer: Viewer
}

interface Viewer {
  repositories: Repositories
  contributions: {
    nodes: {
      nameWithOwner: string
    }[]
  }
}

interface Repositories {
  totalCount: number
  nodes: RepositoryNode[]
  pageInfo: PageInfo
}

interface LanguageNode {
  name: string
  color: string
}

interface ObjectEntry {
  name: string
  type: "blob" | "tree"
  path: string
}

interface RepositoryNode {
  name: string
  nameWithOwner: string
  description: string
  pushedAt: string
  url: string
  defaultBranchRef: {
    name: string
  }
  isPrivate: boolean
  isFork: boolean
  languages: {
    nodes: LanguageNode[]
  }
  object: {
    entries: ObjectEntry[]
  } | null
}

type Project = Pick<
  RepositoryNode,
  "name" | "nameWithOwner" | "description" | "pushedAt" | "url"
> & {
  projectrc?: ProjectRC
  language?: LanguageNode
  defaultBranch?: string
  isContributor: boolean
};

interface PageInfo {
  endCursor: string
  hasNextPage: boolean
}

interface ProjectRC {
  readme: boolean
  npm: boolean
  ignore: boolean
}

function gql(raw: TemplateStringsArray, ...keys: string[]): string {
  return keys.length === 0 ? raw[0]! : String.raw({ raw }, ...keys);
}

const PROJECTRC_SCHEMA = z.object({
  readme: z.boolean().optional().default(false),
  npm: z.boolean().optional().default(false),
  ignore: z.boolean().optional().default(false),
});

const REPOS_TO_IGNORE: string[] = [".github"];

const REPOS_TO_INCLUDE: string[] = ["SchemaStore/schemastore"];

const PROFILE_NAME = process.env.PROFILE_NAME ?? "luxass";

const PROFILE_QUERY = gql`
  #graphql
  query getProfile {
    viewer {
      repositories(
        first: 100
        isFork: false
        privacy: PUBLIC
        orderBy: { field: STARGAZERS, direction: DESC }
      ) {
        totalCount
        nodes {
          name
          isFork
          isPrivate
          nameWithOwner
          description
          pushedAt
          url
          defaultBranchRef {
            name
          }
          languages(first: 1, orderBy: { field: SIZE, direction: DESC }) {
            nodes {
              name
              color
            }
          }
          object(expression: "HEAD:.github") {
            ... on Tree {
              entries {
                name
                type
                path
              }
            }
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
      contributions: repositoriesContributedTo(privacy:PUBLIC, first:100, contributionTypes:[COMMIT, ISSUE, PULL_REQUEST, REPOSITORY,PULL_REQUEST_REVIEW]) {
        nodes {
          nameWithOwner
        }
      }
    }
  }
`;

const REPOSITORY_QUERY = gql`
  #graphql
  query getRepository($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      name
      isFork
      isPrivate
      nameWithOwner
      description
      pushedAt
      url
      defaultBranchRef {
        name
      }
      languages(first: 1, orderBy: { field: SIZE, direction: DESC }) {
        nodes {
          name
          color
        }
      }
      object(expression: "HEAD:.github") {
        ... on Tree {
          entries {
            name
            type
            path
          }
        }
      }
    }
  }
`;

async function run() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("No GITHUB_TOKEN found");
  }

  const { viewer } = await graphql<Profile>(PROFILE_QUERY, {
    headers: {
      "Authorization": `bearer ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!viewer) {
    throw new Error("No profile found");
  }

  const extraRepos = await Promise.all(
    REPOS_TO_INCLUDE.map(async (repo) => {
      let nameWithOwner = repo;
      if (!repo.includes("/")) {
        nameWithOwner = `${PROFILE_NAME}/${repo}`;
      }
      const { repository } = await graphql<{
        repository: RepositoryNode
      }>(REPOSITORY_QUERY, {
        owner: nameWithOwner.split("/")[0],
        name: nameWithOwner.split("/")[1],
        headers: {
          "Authorization": `bearer ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
        },
      });

      if (!repository) {
        throw new Error(`No repository found for ${nameWithOwner}`);
      }

      return repository;
    }),
  );

  // recursively delete everything in ./src/content/projects

  await rm("./src/content/projects", {
    force: true,
    recursive: true,
  });
  await mkdir("./src/content/projects");

  const projectPromises: Promise<Project | undefined>[] = viewer.repositories.nodes
    .concat(extraRepos)
    .filter(
      (repo) =>
        !REPOS_TO_IGNORE.includes(repo.nameWithOwner)
        && !REPOS_TO_IGNORE.includes(repo.nameWithOwner.split("/")[1])
        && !repo.isFork
        && !repo.isPrivate,
    )
    .map(async (repo) => {
      const projectrc = repo.object?.entries?.find(
        (entry) =>
          entry.name === ".projectrc" || entry.name === ".projectrc.json",
      );

      let language = {
        name: "Unknown",
        color: "#333",
      };

      const isContributor = viewer.contributions.nodes.some(
        (contribution) => contribution.nameWithOwner === repo.nameWithOwner,
      );

      if (repo.languages?.nodes?.length) {
        language = repo.languages.nodes[0];
      }

      const defaultBranch = repo.defaultBranchRef?.name || undefined;

      if (!projectrc) {
        if (!REPOS_TO_INCLUDE.includes(repo.nameWithOwner)) {
          return undefined;
        }

        return {
          name: repo.name,
          nameWithOwner: repo.nameWithOwner,
          description: repo.description,
          pushedAt: repo.pushedAt,
          url: repo.url,
          defaultBranch,
          projectrc: undefined,
          language,
          isContributor,
        };
      }

      console.log(
        `Fetching .projectrc for ${repo.nameWithOwner} from ${projectrc.path} on url ${repo.url}/blob/${defaultBranch}/${projectrc.path}?raw=true`,
      );

      const projectrcContent = await fetch(
        `${repo.url}/blob/${defaultBranch}/${projectrc.path}?raw=true`,
      ).then((res) => res.text());

      const parseResult = PROJECTRC_SCHEMA.safeParse(
        JSON.parse(projectrcContent),
      );

      if (!parseResult.success) {
        throw new Error(`Failed to parse .projectrc for ${repo.nameWithOwner}`);
      }

      const projectrcParsed = parseResult.data;

      let readmeUrl = `https://api.github.com/repos/${repo.nameWithOwner}`;
      if (typeof projectrcParsed.readme === "string") {
        readmeUrl += `/contents/${projectrcParsed.readme}`;
      } else {
        readmeUrl += "/readme";
      }

      const res = await fetch(readmeUrl, {
        headers: {
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
        },
      });

      const { content: markdown, encoding } = await res.json();

      if (encoding !== "base64") {
        console.error("Unknown encoding", encoding);
      }

      const text = Buffer.from(markdown, "base64").toString("utf-8");

      const fileName = repo.name.replace(/^\./, "").replace(/\./g, "-");

      const file = await remark().use(remarkComment).process(text);

      await writeFile(`./src/content/projects/${fileName}.mdx`, `---
handle: ${repo.name}
---

${file.toString()}
`);

      return {
        name: repo.name,
        nameWithOwner: repo.nameWithOwner,
        description: repo.description,
        pushedAt: repo.pushedAt,
        url: repo.url,
        defaultBranch,
        projectrc: projectrcParsed,
        language,
        isContributor,
      };
    });

  const projects = await Promise.all(projectPromises);

  const types = "export type Project = typeof projects[number];";

  const code = `${BANNER}\n\n${types}\n\nexport const projects = ${JSON.stringify(
    projects.filter(Boolean),
    null,
    2,
  )};\n`;

  await writeFile("./src/data/projects.ts", code);

  // format projects.ts with eslint
  spawn("npx", ["eslint", "--fix", "./src/data/projects.ts"]);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
