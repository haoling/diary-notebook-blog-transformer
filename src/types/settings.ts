export type Settings = {
  visionApiKey?: string
  notebookImageFolderId?: string
  notebookImageFolderName?: string
}

export type IndexSessionEntry = {
  id: string
  createdAt: string
}

export type IndexPhotoEntry = {
  id: string
  importedAt: string
  sourceType: string
}

export type IndexArticleEntry = {
  id: string
  title: string
  date: string
}

export type AppIndex = {
  sessions: IndexSessionEntry[]
  photos: IndexPhotoEntry[]
  articles: IndexArticleEntry[]
}
