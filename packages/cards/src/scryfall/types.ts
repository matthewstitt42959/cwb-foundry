/** The subset of a Scryfall card object the importer reads. */
export interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  layout: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  keywords?: string[];
  produced_mana?: string[];
  image_uris?: { small?: string; normal?: string };
  card_faces?: { name: string; mana_cost?: string; type_line?: string }[];
}

export interface ScryfallCollectionResponse {
  object: "list";
  data: ScryfallCard[];
  not_found?: { name?: string }[];
}
