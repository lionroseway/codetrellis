// Package client calls the Python orders API.
package client

import (
	"context"
	"fmt"
	"net/http"
)

// BaseURL points at the orders service.
var BaseURL = "http://localhost:8000"

// FetchOrders calls the Python service's orders endpoint.
func FetchOrders(ctx context.Context) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/api/orders", BaseURL), nil)
	if err != nil {
		return nil, err
	}
	return http.DefaultClient.Do(req)
}
