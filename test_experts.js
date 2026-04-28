import { executeGraphQL } from "./build/appsync-client.js";

const LIST_EXPERTS_QUERY = `
  query SearchExperts($query: String) {
    searchExperts(query: $query) {
      email
      name
      description
    }
  }
`;

async function test() {
  try {
    const data = await executeGraphQL(LIST_EXPERTS_QUERY, {});
    console.log(JSON.stringify(data.searchExperts, null, 2));
  } catch (error) {
    console.error(error.message);
  }
}

test();
