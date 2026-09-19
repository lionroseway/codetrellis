// Fixture billing service. Routes are registered through a chi group
// so the callsite extractor has a prefix to resolve.
package main

import (
	"net/http"

	"github.com/codetrellis/fixture/billing/internal/ledger"
	_ "github.com/lib/pq"
)

const defaultPort = ":8081"

var srv *http.Server

type router interface {
	Get(pattern string, h http.HandlerFunc)
	Post(pattern string, h http.HandlerFunc)
	Route(pattern string, fn func(r router))
}

func main() {
	r := newRouter()

	r.Route("/api/billing", func(r router) {
		r.Get("/invoices", listInvoices)
		r.Post("/invoices", createInvoice)
		r.Get("/invoices/{invoiceID}", getInvoice)
	})

	http.HandleFunc("/healthz", healthz)

	srv = &http.Server{Addr: defaultPort}
	_ = srv.ListenAndServe()
}

func listInvoices(w http.ResponseWriter, req *http.Request) {
	_ = ledger.All()
}

func createInvoice(w http.ResponseWriter, req *http.Request) {}

func getInvoice(w http.ResponseWriter, req *http.Request) {}

func healthz(w http.ResponseWriter, req *http.Request) {}

func newRouter() router { return nil }
