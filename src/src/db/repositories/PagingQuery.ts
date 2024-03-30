export class PagingQueryInfo {
    public pageSize: number;
    public pageNumber: number;

    constructor(pageSize: number,
        pageNumber: number) {
        this.pageNumber = pageNumber;
        this.pageSize = pageSize;
    }
}

export class PagingQueryResult<T> {
    public pageSize: number;
    public pageNumber: number;
    public count: number;
    public results: T[];
    public hasMoreResults: boolean;

    constructor(pageSize: number,
        pageNumber: number,
        count: number,
        hasMoreResults: boolean,
        results: T[]) {
        this.pageNumber = pageNumber;
        this.pageSize = pageSize;
        this.count = count;
        this.results = results;
        this.hasMoreResults = hasMoreResults;
    }
}
