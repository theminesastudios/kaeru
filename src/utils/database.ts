import { MiniDatabase } from '@minesa-org/mini-interaction'

type Database = ReturnType<typeof MiniDatabase.fromEnv>

type DiscordConnection = {
  type?: string
  name?: string
  verified?: boolean
}

function normalizeLogin(login: string) {
  return login.trim().toLowerCase()
}

function getGitHubToken() {
  return process.env.GITHUB_TOKEN?.trim() ?? ''
}

function getGithubMetadataOrg() {
  return process.env.GITHUB_METADATA_ORG?.trim() ?? 'minesa-org'
}

async function getDiscordGithubUsername(accessToken: string) {
  const response = await fetch('https://discord.com/api/v10/users/@me/connections', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })

  if (!response.ok) {
    const text = await response.text()
    console.error(
      `[githubOrg] Discord connections fetch failed (${response.status}): ${text}`
    )
    return null
  }

  const connections = (await response.json()) as DiscordConnection[]
  const githubConnection = connections.find(
    (connection) =>
      connection.type === 'github' &&
      typeof connection.name === 'string' &&
      connection.name.length > 0
  )

  return githubConnection?.name ?? null
}

async function isUserMemberOfGithubOrg(githubUsername: string) {
  const token = getGitHubToken()
  if (!token) {
    console.warn(
      '[githubOrg] GITHUB_TOKEN is not set; GitHub org membership check skipped.'
    )
    return false
  }

  const org = getGithubMetadataOrg()
  const normalizedUsername = normalizeLogin(githubUsername)
  const url = `https://api.github.com/orgs/${org}/memberships/${normalizedUsername}`

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })

  if (response.status === 200 || response.status === 204) {
    return true
  }

  if (response.status === 404) {
    return false
  }

  const text = await response.text().catch(() => '')
  console.warn(
    `[githubOrg] Org membership check failed (${response.status}): ${text}`
  )
  return false
}

let database: Database | null = null

/**
 * Shared database instance for the application.
 */
export function getDatabase() {
  database ??= MiniDatabase.fromEnv()
  return database
}

export const db: Pick<Database, 'get' | 'set' | 'update' | 'delete' | 'close'> = {
  get: (...args) => getDatabase().get(...args),
  set: (...args) => getDatabase().set(...args),
  update: (...args) => getDatabase().update(...args),
  delete: (...args) => getDatabase().delete(...args),
  close: (...args) => getDatabase().close(...args)
}

/**
 * Gets user data from the database.
 */
export async function getUserData(userId: string) {
  try {
    return await db.get(userId)
  } catch (error) {
    console.error('❌ Error getting user data:', error)
    throw error
  }
}

/**
 * Sets user's is_miniapp status.
 * Always true. No gating. Everyone connects.
 */
export async function setUserMiniAppStatus(userId: string) {
  try {
    return await db.set(userId, {
      userId,
      is_miniapp: true,
      lastUpdated: Date.now()
    })
  } catch (error) {
    console.error('❌ Error setting user miniapp status:', error)
    throw error
  }
}

/**
 * Updates user metadata for Discord linked roles.
 * is_miniapp is always true.
 */
export async function updateDiscordMetadata(userId: string, accessToken: string) {
  await setUserMiniAppStatus(userId)

  const githubUsername = await getDiscordGithubUsername(accessToken)
  let isGithubOrgMember = false

  if (githubUsername) {
    try {
      isGithubOrgMember = await isUserMemberOfGithubOrg(githubUsername)
    } catch (error) {
      console.error('[updateDiscordMetadata] GitHub org membership check failed:', error)
    }
  }

  const existing = await db.get(userId).catch(() => null)
  const base =
    existing && typeof existing === 'object'
      ? (existing as Record<string, unknown>)
      : {}

  await db.set(userId, {
    ...base,
    userId,
    is_miniapp: true,
    githubUsername: githubUsername ?? null,
    githubOrg: getGithubMetadataOrg(),
    isGithubOrgMember,
    lastUpdated: Date.now()
  })

  const metadata = {
    platform_name: 'Mini-Interaction',
    username: githubUsername ?? null,
    metadata: {
      is_miniapp: 1,
      github_org_member: isGithubOrgMember ? 1 : 0
    }
  }

  const response = await fetch(
    `https://discord.com/api/v10/users/@me/applications/${process.env.DISCORD_APPLICATION_ID}/role-connection`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to update Discord metadata: ${error}`)
  }

  return await response.json()
}
