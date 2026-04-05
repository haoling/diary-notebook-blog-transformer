export type ParagraphBlock = {
  type: 'paragraph'
  sessionId: string
  paragraphId: string
}

export type PhotoBlock = {
  type: 'photo'
  photoId: string
}

export type ArticleBlock = ParagraphBlock | PhotoBlock

export type Article = {
  id: string
  title: string
  date: string
  blocks: ArticleBlock[]
  publishTargets: Array<'wordpress' | 'zenn' | 'private'>
}
